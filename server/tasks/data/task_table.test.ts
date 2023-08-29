import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {addHours} from "date-fns";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {
    authorizeTaskQueryAccess,
    commitTaskActionTransaction,
    commitTaskActionTransactionBeforeExecuteTestCheckpoint,
} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";

const context = createTestContext();

// Old style tests shadow the `context` variable and add some modules.
const baseContext = context;

function testAuthorizeTaskQueryAccess(
    context: ServerSessionActionContext,
    options?: {
        filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
    },
) {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: context.actor.getAccountId(),
        currentDate: toCalendarDate(
            parseAbsolute(testClock.nowDate().toISOString(), defaultTimeZone),
        ),
    };

    const filters = options?.filters
        ? isReadonlyArray(options.filters)
            ? normalizeTaskQueryFilters(options.filters, evaluationContext)
            : ({type: "Possible", normalizedFilters: options.filters} as const)
        : normalizeTaskQueryFilters([], evaluationContext);

    if (filters.type === "Impossible") {
        throw new InvalidArgumentError("Impossible filters");
    }

    return authorizeTaskQueryAccess(
        context,
        {
            filters: filters.normalizedFilters,
            sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
        },
        {
            getTaskIndexDocIfExists: () => undefined,
            getCollectionIndexDocIfExists: () => undefined,
        },
    );
}

describe("old style", () => {
    const context = {
        ...baseContext,
        action: session => {
            return baseContext.action(session).clone({
                tasks: new TestTaskContextModule({
                    shouldSkipIndexing: true,
                    dangerouslyEscalateToSystemContext: baseContext.escalateToSystemContext,
                }),
            });
        },
    } satisfies TestContext;

    const space = createTestSpace(context);
    const session1 = createTestSession(context, space);
    const session2 = createTestSession(context, space);
    const session3 = createTestSession(context, space);
    const otherSpace = createTestSpace(context);
    const otherSession = createTestSession(context, otherSpace);
    const sharedSession = createTestSession(context, space);

    beforeAll(async () => {
        const SpacesTable = getSpacesTableForTest();

        await runAllPromises([
            SpacesTable.createItem(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: otherSpace.id,
                accountId: sharedSession.accountId,
                joinedTime: new Date(),
            }),
        ]);
    });

    const taskAccount1 = new TaskSortableAccount({
        accountId: session1.accountId,
        workingAccountName: session1.account.name,
    });

    const taskAccount2 = new TaskSortableAccount({
        accountId: session2.accountId,
        workingAccountName: session2.account.name,
    });

    const otherTaskAccount = new TaskSortableAccount({
        accountId: otherSession.accountId,
        workingAccountName: otherSession.account.name,
    });

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

    let spaceCount = 2;

    // We create a new space for some tests for resources that are tied to account
    // + space. So tests don't conflict.
    async function createSeparateSpace() {
        const SpacesTable = getSpacesTableForTest();

        const spaceId = generateId<SpaceId>();

        const createdTime = new Date();

        await runAllPromises([
            SpacesTable.createItem(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
                name: `Space ${spaceCount++}`,
                createdTime,
            }),
            SpacesTable.createItem(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId: session1.accountId,
                joinedTime: createdTime,
            }),
            SpacesTable.createItem(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId: session2.accountId,
                joinedTime: createdTime,
            }),
            SpacesTable.createItem(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId: session3.accountId,
                joinedTime: createdTime,
            }),
        ]);

        return {space: {id: spaceId}};
    }

    async function createPublicTask(
        session: TestSessionItem,
        spaceId: SpaceId,
        level: TaskCollectionAccessLevel = "Edit",
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
                    accessPolicy: {
                        accountGrantById: new Map([[session.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level},
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: session.accountId,
                        workingAccountName: session.account.name,
                    }),
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
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);
    });

    test("can't create task in space you don't have access to", async () => {
        await expect(
            commitTaskActionTransaction(context.action(session1), otherSpace.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't create a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't create a task with the wrong account as the creator", async () => {
        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't delete a task that doesn't exist", async () => {
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

    test("can't delete a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't delete a task with the same time as task creation", async () => {
        const taskId = generateId<TaskId>();

        const createdTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: createdTime,
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task with a time earlier than task creation", async () => {
        const taskId = generateId<TaskId>();

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task that's not yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can delete a task that's in a collection you specifically can edit", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task that's only in a collection you specifically can view", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can delete a task that's in a collection you can edit by default", async () => {
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

    test("can't delete a task that's only in a collection you can view by default", async () => {
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

    test("can't delete a task that's only in a collection space accounts can edit by default if you're from a different space", async () => {
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
                    creator: taskAccount1,
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

    test("can undelete a task twice if there's another delete", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can undelete a task twice if there's another delete in one transaction", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't undelete a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't a task that doesn't exist", async () => {
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

    test("can't undelete a task with the same time as the deletion time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't undelete a task with a time before the deletion time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't undelete a task with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't undelete a task that isn't yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't undelete a task in a collection you don't have edit access to", async () => {
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

    test("can update a task's title", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can update a task's title in any order", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update a task title for a task that doesn't exist", async () => {
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

    test("can't update a deleted task's title", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't update a task title that's not yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can update a task's title that's in a collection you can edit", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update a task's title that's only in a collection you specifically can view", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't add a task you don't have access to to a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                    creator: taskAccount1,
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

    test("can't add a task to a collection you don't have access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                    creator: taskAccount1,
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

    test("can add a task that's not yours to a collection", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't add a task to a collection you don't have edit access to", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't add a task to a collection with an unreasonable update time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task from a collection with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task from a collection you don't have access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't delete a task from a collection you don't have edit access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
        ]);
    });

    test("can't create a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                        accessPolicy: {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't create a collection with the wrong creator", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [taskAccount2.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError(
                'Must have the "Manage" access level on a collection you create',
            ),
        );
    });

    test("can't create a collection with an unreasonable created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't create a collection without our account as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        accessPolicy: {
                            accountGrantById: new Map([]),
                            defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection that doesn't exist", async () => {
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

    test("can't delete a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection with the created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        const createdTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: createdTime,
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection with a time before the created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection with an unreasonable deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection you don't have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't delete a collection you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection that doesn't exist", async () => {
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

    test("can undelete a collection twice if there's another delete", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can undelete a collection twice if there's another delete in one transaction", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection with the deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection a time before the deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection you don't have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't undelete a collection you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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

    test("can update a collection's name", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't update a collection name for a collection that doesn't exist", async () => {
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

    test("can't update a deleted collection's title", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't update a collection name that's not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't update a collection name with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't update a collection name you don't have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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

    test("can't update a collection name you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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

    test("can update a collection's access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage"}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
        ]);
    });

    test("can't update a collection access policy for a collection that doesn't exist", async () => {
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can't update a deleted collection's access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't update a collection access policy that's not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't update a collection access policy with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't update a collection access policy you don't have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't update a collection access policy you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage"}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
        ]);
    });

    test("can't update a collection access policy with no manage grants", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Edit"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError(
                '`accessPolicy` must grant at least one account the "Manage" access level',
            ),
        );

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([]),
                            defaultGrant: {type: "Space", level: "Edit"},
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError(
                '`accessPolicy` must grant at least one account the "Manage" access level',
            ),
        );

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        accountGrantById: new Map([]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Manage"}],
                        ]),
                        defaultGrant: null,
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
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                                [taskAccount2.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't create task twice race condition", async () => {
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
                    creator: taskAccount1,
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
                    creator: taskAccount2,
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        unpause();

        await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
    });

    test("can't create collection twice race condition", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount2.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
        ]);

        unpause();

        await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
    });

    // Our authorization code is implemented with the reasoning: if you had access
    // in a small window of time (<1 min) before the commit we allow the action.
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    // Our authorization code is implemented with the reasoning: if you had access
    // in a small window of time (<1 min) before the commit we allow the action.
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
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
                    creator: taskAccount1,
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

    test("can't update task due date with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't update priority with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't update task parent with unreasonable update time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't update task parent on a task that doesn't exist", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent with a task that doesn't exist", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent to deleted task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't update task parent where grandparent is a deleted task", async () => {
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can't update task parent on a task you don't have edit access to", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount2,
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

    test("can't update task parent to a task you don't have edit access to", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                    creator: taskAccount1,
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

    test("can't update task parent to a task you have view but not edit access to", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                    creator: taskAccount1,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                    creator: taskAccount2,
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("child tasks don't inherit the permissions of their deleted parent task", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage"}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                    creator: taskAccount2,
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

    test("child tasks don't inherit the permissions of their deleted parent task multiple levels up", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage"}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("child tasks can't create a circular dependency", async () => {
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (2 tasks)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (3 tasks)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 1)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 2)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 3)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 4)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (5 tasks, scenario 5)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can't create a circular dependency even in race conditions (9 tasks)", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
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

    test("can't create a circular dependency with undelete even in race conditions", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                "Updating task's `parentTaskId` would create a circular dependency",
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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

    test("can remove the parent of a child task when you don't have access to the parent task", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount2,
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

    test("can change the parent of a child task when you don't have access to the parent task", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount2,
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
                    creator: taskAccount2,
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

    test("can delete a child task when you don't have access to the parent task", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                        defaultGrant: {type: "Space", level: "Manage"},
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount2,
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

    test("can't update task parent order key when there is no parent", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
        ).rejects.toThrow(new FailedPreconditionError("Task does not have a parent"));
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
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent order key with unreasonable updated time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent order key when parent is deleted", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent order key when you don't have edit access to parent", async () => {
        const taskId1 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task parent order key if order time is unreasonable", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    creator: taskAccount1,
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
                        closer: taskAccount1,
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

    test("can't update task status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            closer: taskAccount1,
                            closedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can't update task status with unreasonable closed time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            closer: taskAccount1,
                            closedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `closedTime` is too far in the future"));
    });

    test("can't update task status with a closer other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            closer: taskAccount2,
                            closedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Can only close a task with yourself as the closer"),
        );
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
                    creator: taskAccount1,
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
                        assignee: taskAccount2,
                        assigner: taskAccount1,
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
                        assignee: taskAccount1,
                        assigner: taskAccount1,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);
    });

    test("can't update task assignee with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            assignee: taskAccount2,
                            assigner: taskAccount1,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can't update task assignee with unreasonable assigned time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            assignee: taskAccount2,
                            assigner: taskAccount1,
                            assignedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError("Action `assignedTime` is too far in the future"),
        );
    });

    test("can't update task assignee with an assigner other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            assignee: taskAccount2,
                            assigner: taskAccount2,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Can only assign a task with yourself as the assigner"),
        );
    });

    test("can't update task assignee with an assignee outside the current space", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                            assignee: otherTaskAccount,
                            assigner: taskAccount1,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Can't assign a task to an account outside of the current space",
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
                        assignee: taskAccount2,
                        assigner: taskAccount1,
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

    test("can't update task assignee status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                        assignee: taskAccount2,
                        assigner: taskAccount1,
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

    test("can't update task assignee status with unreasonable activated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                        assignee: taskAccount2,
                        assigner: taskAccount1,
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

    test("can update task assignee active position", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assignee: taskAccount1,
                        assigner: taskAccount1,
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
                    type: "UpdateAssigneeActivePosition",
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
                    type: "UpdateAssigneeActivePosition",
                    accountId: session1.accountId,
                    position: {orderTime: clock.now(), orderKey: assertOrderKey("a3")},
                },
            },
        ]);
    });

    test("can't update task assignee active position when another account is assigned", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assignee: taskAccount2,
                        assigner: taskAccount1,
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
                        type: "UpdateAssigneeActivePosition",
                        accountId: session1.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Can only update the task's active position if you are the task's assignee",
            ),
        );
    });

    test("can't update task assignee active position when no account is assigned", async () => {
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
                        type: "UpdateAssigneeActivePosition",
                        accountId: session1.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Can only update the task's active position if you are the task's assignee",
            ),
        );
    });

    test("can't update task assignee active position with an account id other than your own", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assignee: taskAccount1,
                        assigner: taskAccount1,
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
                        type: "UpdateAssigneeActivePosition",
                        accountId: session2.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Must use the actor `AccountId` when updating the task's active position",
            ),
        );
    });

    test("can't update task assignee active position with unreasonable order time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                        assignee: taskAccount1,
                        assigner: taskAccount1,
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
                        type: "UpdateAssigneeActivePosition",
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position with an unreasonable update time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position with an unreasonable order time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position with a task that doesn't exist", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position with a task that's not in the collection", async () => {
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
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position with a task that was removed from the collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position when you don't have access to the collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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

    test("can't update task position when you only have view access to the collection", async () => {
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

    test("can add task to notepad page", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);
    });

    test("can add task to notepad page in one transaction", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);
    });

    test("can add task to notepad page that hasn't been created", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);
    });

    test("can't create a notepad page for someone else", async () => {
        const {space} = await createSeparateSpace();
        const notepadPageId = generateTaskNotepadPageId();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateNotepadPage",
                    time: clock.now(),
                    accountId: session2.accountId,
                    notepadPageId,
                    notepadPageAction: {
                        type: "Create",
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Can only access your account's notepad"));
    });

    test("can't add a task to someone else's notepad page", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Can only access your account's notepad"));
    });

    test("can't create a notepad page twice", async () => {
        const {space} = await createSeparateSpace();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateNotepadPage",
                    time: clock.now(),
                    accountId: session1.accountId,
                    notepadPageId,
                    notepadPageAction: {
                        type: "Create",
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Notepad page already exists"));
    });

    test("can remove task from notepad page that hasn't been created", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);
    });

    test("can't add task to notepad page with an unreasonable update time", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can't add task to notepad page with an unreasonable order time", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: getUnreasonableTime(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
    });

    test("can't add task to notepad page that doesn't exist", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new NotFoundError("Task not found"));
    });

    test("can't add task you don't have access to to notepad page", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't add task you have view access to to notepad page", async () => {
        const {space} = await createSeparateSpace();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        const {taskId} = await createPublicTask(session2, space.id, "View");

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError('Actor does not have "Edit" access level to task'),
        );
    });

    test("can't add tasks you didn't create to notepad page", async () => {
        const {space} = await createSeparateSpace();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        const {taskId} = await createPublicTask(session2, space.id);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Can only add tasks you created to your account's notepad"),
        );
    });

    test("can remove task from notepad page", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);
    });

    test("can remove task from notepad page twice", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);
    });

    test("can remove task from notepad page even if the task was not added", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);
    });

    test("can't remove task from notepad page with an unreasonable update time", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                    creator: taskAccount1,
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
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: null,
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can't remove task from notepad page when the task doesn't exist", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: null,
                    },
                },
            ]),
        ).rejects.toThrow(new NotFoundError("Task not found"));
    });

    test("can't remove task you don't have access to from notepad page", async () => {
        const {space} = await createSeparateSpace();
        const taskId = generateId<TaskId>();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount2,
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
                        type: "UpdateNotepadPagePosition",
                        accountId: session1.accountId,
                        notepadPageId,
                        position: null,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can remove task you have view access to from notepad page", async () => {
        const {space} = await createSeparateSpace();
        const notepadPageId = generateTaskNotepadPageId();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateNotepadPage",
                time: clock.now(),
                accountId: session1.accountId,
                notepadPageId,
                notepadPageAction: {
                    type: "Create",
                },
            },
        ]);

        const {taskId} = await createPublicTask(session1, space.id, "View");

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateNotepadPagePosition",
                    accountId: session1.accountId,
                    notepadPageId,
                    position: null,
                },
            },
        ]);
    });

    test("can't update a task's title with an account in a different space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
    });

    test("can't update a task's title in the context of the wrong space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Space mismatch"));

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

    test("can't update a collection's name with an account in a different space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
    });

    test("can't update a collection's name in the context of the wrong space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Space mismatch"));

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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
                        creator: taskAccount1,
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toEqual({
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
        ).toEqual({
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
        ).toEqual({
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
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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
                            closer: taskAccount1,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toEqual({
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

test("can't update task in a deleted public collection", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const collection = await TestTaskCollection.createPublic(session1);
    const task = await TestTask.create(session1);

    await expect(task.updatePriority(session2, "High")).rejects.toThrow(PermissionDeniedError);

    await task.addCollection(session1, collection);

    await task.updatePriority(session2, "High");

    await collection.delete(session1);

    await expect(task.updatePriority(session2, "Medium")).rejects.toThrow(PermissionDeniedError);

    await collection.undelete(session1);

    await task.updatePriority(session2, "Medium");
});

test("can't add task to a deleted public collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session);
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.addCollection(session, collection);

    await collection.delete(session);

    await expect(task2.addCollection(session, collection)).rejects.toThrow(PermissionDeniedError);

    await collection.undelete(session);

    await task3.addCollection(session, collection);
});

test("can't remove task from a deleted public collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session);
    const task = await TestTask.create(session);

    await task.addCollection(session, collection);

    await collection.delete(session);

    await expect(task.removeCollection(session, collection)).rejects.toThrow(PermissionDeniedError);

    await collection.undelete(session);

    await task.removeCollection(session, collection);
});

test("can't update collection name in a deleted public collection", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const collection = await TestTaskCollection.createPublic(session1);

    await collection.updateName(session2, "Test 1");

    await collection.delete(session1);

    await expect(collection.updateName(session2, "Test 2")).rejects.toThrow(
        FailedPreconditionError,
    );

    await collection.undelete(session1);

    await collection.updateName(session2, "Test 2");
});

test("task assignee can update the task", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(session1);

    await expect(task.updatePriority(session2, "High")).rejects.toThrow(PermissionDeniedError);

    await task.updateAssignee(session1, session2);

    await task.updatePriority(session2, "High");

    await task.updateAssignee(session1, null);

    await expect(task.updatePriority(session2, "Medium")).rejects.toThrow(PermissionDeniedError);
});

test("can't authorize query with no filters", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(testAuthorizeTaskQueryAccess(session.action())).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("authorizes a query with creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session.account.id}],
                },
            },
        ],
    });
});

test("doesn't authorize a query that only excludes creator in filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "NoneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize a query with other accounts in creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "CurrentAccount"},
                            {type: "Account", accountId: otherSession.account.id},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session.account.id},
                            {type: "Account", accountId: otherSession.account.id},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize a query with missing creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "MissingAccount"}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}, {type: "MissingAccount"}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session.account.id},
                            {type: "MissingAccount"},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("authorizes a query with assignee filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {type: "Assignee", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session.account.id}],
                },
            },
        ],
    });
});

test("doesn't authorize a query that only excludes assignee in filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "NoneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize a query with other accounts in assignee filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "CurrentAccount"},
                            {type: "Account", accountId: otherSession.account.id},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session.account.id},
                            {type: "Account", accountId: otherSession.account.id},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize a query with missing assignee filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "MissingAccount"}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}, {type: "MissingAccount"}],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session.account.id},
                            {type: "MissingAccount"},
                        ],
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can authorize a query with notepad page filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            notepadPageFilter: {
                accountId: session.account.id,
                notepadPageId: generateTaskNotepadPageId(),
            },
        },
    });
});

test("can't authorize a query with other account's notepad page filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                notepadPageFilter: {
                    accountId: session2.account.id,
                    notepadPageId: generateTaskNotepadPageId(),
                },
            },
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can authorize a query with a collection you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection.id]),
                },
            },
        ],
    });
});

test("can't authorize a query with a collection you don't have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPrivate(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can't authorize an excludes all of query with a collection you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "ExcludesAllOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize an is empty collection query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IsEmpty",
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can authorize a query with one of three collections you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                },
            },
        ],
    });
});

test("can't authorize a query with one of two collections you have access to and one you don't", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can authorize a query with all of three collections you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                },
            },
        ],
    });
});

test("can't authorize a query with all of two collections you have access to and one you don't", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can't authorize a query with excludes all of three collections you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "ExcludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("can't authorize a query with excludes all of two collections you have access to and one you don't", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "ExcludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can authorize a query when filtering by a collection you don't have access to that's ignored by boolean logic", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1.id, collection3.id]),
                },
            },
        ],
    });

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1.id, collection3.id]),
                },
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id]),
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection3.id]),
                    },
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can't authorize is empty collection filter with an accessible collection filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                collectionsFilter: [
                    assertNonEmptyReadonlyMap(
                        new Map<TaskCollectionId | "IsEmpty", boolean>([
                            ["IsEmpty", false],
                            [collection.id, false],
                        ]),
                    ),
                ],
            },
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    // This is an impossible filter which will return no results.
    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            collectionsFilter: [
                assertNonEmptyReadonlyMap(
                    new Map<TaskCollectionId | "IsEmpty", boolean>([["IsEmpty", false]]),
                ),
                assertNonEmptyReadonlyMap(
                    new Map<TaskCollectionId | "IsEmpty", boolean>([[collection.id, false]]),
                ),
            ],
        },
    });
});

test("can authorize a query when filtering by a collection filter merged by boolean logic", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);
    const collection3 = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1.id, collection2.id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1.id, collection3.id]),
                },
            },
        ],
    });
});

test("can authorize an excludes collections query when with a passing filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1.id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2.id]),
                },
            },
        ],
    });

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2.id]),
                },
            },
        ],
    });
});

test("can authorize a query with a parent filter for a task you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });
});

test("can't authorize a query with a parent filter for a task you don't have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPrivate(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        }),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "View" access level to task'));
});

test("can authorize a query with a parent filter for a task you have access to transitively", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);
    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session1);

    await task1.addCollection(session1, collection);
    await task2.updateParentTask(session1, task1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task2.id,
            },
        },
    });
});

test("can't authorize a query with a parent filter for a task you don't have access to transitively", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPrivate(session1);
    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session1);

    await task1.addCollection(session1, collection);
    await task2.updateParentTask(session1, task1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task2.id,
                },
            },
        }),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "View" access level to task'));
});

test("can't authorize a query with a parent filter for a deleted task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.createPublic(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });

    await task.delete(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        }),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "View" access level to task'));

    await task.undelete(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });
});

test("must have a parent filter to sort by parent position", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session);

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            sorts: [{type: "ParentPosition", direction: "Ascending", missing: "Last"}],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("Must filter by a parent task to sort by parent position"),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
        sorts: [{type: "ParentPosition", direction: "Ascending", missing: "Last"}],
    });
});

test("must be allowed to access collection to sort by collection position", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection1.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
        ],
        sorts: [
            {
                type: "CollectionPosition",
                collectionId: collection1.id,
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection2.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("must be allowed to access collection to sort by collection position with collection filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPrivate(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1.id]),
                },
            },
        ],
        sorts: [
            {
                type: "CollectionPosition",
                collectionId: collection1.id,
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id]),
                    },
                },
            ],
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection2.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError('Actor does not have "View" access level to task collection'),
    );
});

test("can only sort by your notepad page positions", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            sorts: [
                {
                    type: "NotepadPagePosition",
                    accountId: session1.account.id,
                    notepadPageId: generateTaskNotepadPageId(),
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    await testAuthorizeTaskQueryAccess(session1.action(), {
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
        ],
        sorts: [
            {
                type: "NotepadPagePosition",
                accountId: session1.account.id,
                notepadPageId: generateTaskNotepadPageId(),
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "NotepadPagePosition",
                    accountId: session1.account.id,
                    notepadPageId: generateTaskNotepadPageId(),
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(new PermissionDeniedError("Can't sort by notepad page that's not yours"));
});

test("must filter by assignee to sort by active position", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            sorts: [
                {
                    type: "AssigneeActivePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Must filter assignee to session account to sort by active position",
        ),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ],
        sorts: [
            {
                type: "AssigneeActivePosition",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "AssigneeActivePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Must filter assignee to session account to sort by active position",
        ),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ],
        sorts: [
            {
                type: "AssigneeActivePosition",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });
});
