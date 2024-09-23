import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {addDays, addHours} from "date-fns";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {updateOurAccountNameBeforeExecuteTestCheckpoint} from "~/server/accounts/accounts_table.js";
import {updateOurAccountName} from "~/server/accounts/update_name/update_our_account_name.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {addSpaceAccountForTest} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {
    authorizeTaskAccess,
    authorizeTaskQueryAccess,
    backfillTaskActionTransactionHistory,
    backfillTaskComments,
    commitTaskActionTransaction,
    commitTaskActionTransactionBeforeExecuteTestCheckpoint,
    createTaskComment,
    deleteTaskAndAllChildren,
    deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint,
    deleteTaskComment,
    getTaskComment,
    getTaskCommentPayload,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskNotesContent,
    getTaskNotesContentAndInitialComments,
    getTaskNotesContentWithoutReferences,
    getTaskNotificationSubscribers,
    getTaskOwner,
    updateTaskCommentContent,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
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
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {TaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {
    emptyTaskNotesContent,
    TaskNotesContentProsemirrorSchema as schema,
} from "~/shared/tasks/task_notes_content_schema.js";
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

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
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

    // We create a new space for some tests for resources that are tied to account
    // + space. So tests don't conflict.
    async function createSeparateSpace() {
        const space = await TestSpace.create(context);

        await runAllPromises([
            addSpaceAccountForTest(context, {
                spaceId: space.id,
                accountId: session1.accountId,
            }),
            addSpaceAccountForTest(context, {
                spaceId: space.id,
                accountId: session2.accountId,
            }),
            addSpaceAccountForTest(context, {
                spaceId: space.id,
                accountId: session3.accountId,
            }),
        ]);

        return {space};
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
                    creatorId: session.account.id,
                    name: "Test",
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
                    creatorId: session.accountId,
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
                    creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
        ).rejects.toThrow(PermissionDeniedError);
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
        ).rejects.toThrow(PermissionDeniedError);
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
                        accountGrantById: new Map([[taskAccount1.accountId, {level: "Manage"}]]),
                        defaultGrant: null,
                    },
                },
            },
        ]);
    });

    test("can't create a collection with no creator", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creatorId: null,
                        name: "Test",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
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
                        creatorId: session2.account.id,
                        name: "Test",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage"}],
                            ]),
                            defaultGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                        creatorId: session1.account.id,
                        name: "Test",
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

    test("can't create a collection with the wrong account in access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creatorId: session1.account.id,
                        name: "Test",
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
                        creatorId: session1.account.id,
                        name: "Test",
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
                        creatorId: session1.account.id,
                        name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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

    test("can't update a deleted collection's name", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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

    test("can update a collection's color", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                    type: "UpdateColor",
                    color: "purple",
                },
            },
        ]);
    });

    test("can't update a collection color for a collection that doesn't exist", async () => {
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

    test("can't update a deleted collection's color", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can't update a collection color that's not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't update a collection color with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can't update a collection color you don't have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can't update a collection color you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    type: "UpdateColor",
                    color: "purple",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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

    test("can't update task parent and parent position with unreasonable time at the same time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session2.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.account.id,
                    name: "Test",
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
                    creatorId: session2.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session2.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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

    test("can't update task status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task status with unreasonable closed time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task status with a closer other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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

    test("can't update task status and assignee status if assignee status has an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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

    test("can't update task assignee with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee with unreasonable assigned time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee with an assigner other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee with an assignee outside the current space", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee status with unreasonable activated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.accountId,
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

    test("can update task assignee and assignee status at the same time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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

    test("can't update task assignee and assignee status with unreasonable time at the same time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
                    creatorId: session1.account.id,
                    name: "Test",
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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session2.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session2.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session1.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
                    creatorId: session2.accountId,
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
        const notepadPageId = generateTaskNotepadPageId(testClock);

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
        ).rejects.toThrow(new PermissionDeniedError("Account doesn't have access to space"));
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
        ).rejects.toThrow(new PermissionDeniedError("Account doesn't have access to space"));
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                            closerId: session1.accountId,
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
                            closerId: session1.accountId,
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
                            closerId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                            closerId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                        creatorId: session1.accountId,
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
                            closerId: session1.accountId,
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
                            closerId: session1.accountId,
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
                notepadPageId: generateTaskNotepadPageId(testClock),
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
                    notepadPageId: generateTaskNotepadPageId(testClock),
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

test("can authorize a query with a parent filter for a deleted task", async () => {
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

    await testAuthorizeTaskQueryAccess(session2.action(), {
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });

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
                    notepadPageId: generateTaskNotepadPageId(testClock),
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
                notepadPageId: generateTaskNotepadPageId(testClock),
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
                    notepadPageId: generateTaskNotepadPageId(testClock),
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

test("can't set task as own parent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    await expect(task.updateParentTask(session, task)).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );
});

test("can delete a task and all its children when it has no children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    expect(await deleteTaskAndAllChildren(TestTask.action(session), task.id, actionTime)).toEqual({
        spaceId: space.id,
        actions: [
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task.id,
                taskAction: {type: "Delete"},
            },
        ],
    });

    expect((await task.getItem()).deletedTime).toEqual(actionTime);
});

test("can't delete a task and all its children when the task doesn't exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const actionTime = testClock.nowLogical();

    await expect(
        deleteTaskAndAllChildren(TestTask.action(session), generateId(), actionTime),
    ).rejects.toThrow(NotFoundError);
});

test("can't delete a task and all its children when you don't have access to the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    await expect(
        deleteTaskAndAllChildren(TestTask.action(session2), task.id, actionTime),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await task.getItem()).deletedTime).toEqual(null);
});

test("can delete a task and all its children when you have access to the task through a collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPrivate(session1);
    await task.addCollection(session1, collection);

    await collection.updateAccessPolicy(session1, {
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage"}],
            [session3.account.id, {level: "Manage"}],
        ]),
        defaultGrant: null,
    });

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    await expect(
        deleteTaskAndAllChildren(TestTask.action(session2), task.id, actionTime),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await task.getItem()).deletedTime).toEqual(null);

    expect(await deleteTaskAndAllChildren(TestTask.action(session3), task.id, actionTime)).toEqual({
        spaceId: space.id,
        actions: [
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task.id,
                taskAction: {type: "Delete"},
            },
        ],
    });

    expect((await task.getItem()).deletedTime).toEqual(actionTime);
});

test("can delete a task and all its children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6, task7, task8, task9, task10] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

    await runAllPromises([
        task2.updateParentTask(session, task1),
        task3.updateParentTask(session, task1),
        task4.updateParentTask(session, task1),
        task5.updateParentTask(session, task3),
        task6.updateParentTask(session, task5),
        task7.updateParentTask(session, task5),
        task8.updateParentTask(session, task4),
        task1.updateParentTask(session, task9),
        task7.updateStatus(session, "Closed"),
    ]);

    expect((await task1.getItem()).deletedTime).toEqual(null);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(null);
    expect((await task4.getItem()).deletedTime).toEqual(null);
    expect((await task5.getItem()).deletedTime).toEqual(null);
    expect((await task6.getItem()).deletedTime).toEqual(null);
    expect((await task7.getItem()).deletedTime).toEqual(null);
    expect((await task8.getItem()).deletedTime).toEqual(null);
    expect((await task9.getItem()).deletedTime).toEqual(null);
    expect((await task10.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    expect(
        (await deleteTaskAndAllChildren(TestTask.action(session), task1.id, actionTime)).actions
            .slice()
            .sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
    ).toEqual(
        [
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task2.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task3.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task4.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task5.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task6.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task7.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task8.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: task9.id,
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
                time: [actionTime[0], actionTime[1] + 1],
                taskId: task1.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 3,
                    removedChildTaskCount: 3,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: task3.id,
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
                time: [actionTime[0], actionTime[1] + 1],
                taskId: task5.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 2,
                    removedChildTaskCount: 2,
                    addedClosedChildTaskCount: 1,
                    removedClosedChildTaskCount: 1,
                },
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: task4.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 1,
                    removedChildTaskCount: 1,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
        ].sort((action1, action2) =>
            defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
        ),
    );

    expect((await task1.getItem()).deletedTime).toEqual(actionTime);
    expect((await task2.getItem()).deletedTime).toEqual(actionTime);
    expect((await task3.getItem()).deletedTime).toEqual(actionTime);
    expect((await task4.getItem()).deletedTime).toEqual(actionTime);
    expect((await task5.getItem()).deletedTime).toEqual(actionTime);
    expect((await task6.getItem()).deletedTime).toEqual(actionTime);
    expect((await task7.getItem()).deletedTime).toEqual(actionTime);
    expect((await task8.getItem()).deletedTime).toEqual(actionTime);
    expect((await task9.getItem()).deletedTime).toEqual(null);
    expect((await task10.getItem()).deletedTime).toEqual(null);
});

test("can handle race conditions when deleting a task and all of it's children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [parentTask1, parentTask2, task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await runAllPromises([
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask1),
        task3.updateParentTask(session, parentTask2),
        task5.updateParentTask(session, parentTask1),
    ]);

    expect((await parentTask1.getItem()).deletedTime).toEqual(null);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(null);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(null);
    expect((await task4.getItem()).deletedTime).toEqual(null);
    expect((await task5.getItem()).deletedTime).toEqual(null);

    const pausePromise = deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.pauseForTest(
        session.account.id,
    );

    const actionTime = testClock.nowLogical();
    const deletePromise = deleteTaskAndAllChildren(
        TestTask.action(session),
        parentTask1.id,
        actionTime,
    );

    const {unpause} = await pausePromise;

    await task2.updateParentTask(session, parentTask2);
    await task3.updateParentTask(session, parentTask1);
    await task4.updateParentTask(session, parentTask1);
    await task5.updateParentTask(session, null);

    expect((await parentTask1.getItem()).deletedTime).toEqual(null);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(null);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(null);
    expect((await task4.getItem()).deletedTime).toEqual(null);
    expect((await task5.getItem()).deletedTime).toEqual(null);

    unpause();

    expect(
        (await deletePromise).actions
            .slice()
            .sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
    ).toEqual(
        [
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: parentTask1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task3.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task4.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: parentTask1.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 5,
                    removedChildTaskCount: 5,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
        ].sort((action1, action2) =>
            defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
        ),
    );

    expect((await parentTask1.getItem()).deletedTime).toEqual(actionTime);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(actionTime);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(actionTime);
    expect((await task4.getItem()).deletedTime).toEqual(actionTime);
    expect((await task5.getItem()).deletedTime).toEqual(null);
});

test("can handle race conditions when deleting a task with parent and all of it's children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [grandParentTask, parentTask1, parentTask2, task1, task2, task3, task4, task5] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

    await runAllPromises([
        parentTask1.updateParentTask(session, grandParentTask),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask1),
        task3.updateParentTask(session, parentTask2),
        task5.updateParentTask(session, parentTask1),
    ]);

    expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
    expect((await parentTask1.getItem()).deletedTime).toEqual(null);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(null);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(null);
    expect((await task4.getItem()).deletedTime).toEqual(null);
    expect((await task5.getItem()).deletedTime).toEqual(null);

    const pausePromise = deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.pauseForTest(
        session.account.id,
    );

    const actionTime = testClock.nowLogical();
    const deletePromise = deleteTaskAndAllChildren(
        TestTask.action(session),
        parentTask1.id,
        actionTime,
    );

    const {unpause} = await pausePromise;

    await task2.updateParentTask(session, parentTask2);
    await task3.updateParentTask(session, parentTask1);
    await task4.updateParentTask(session, parentTask1);
    await task5.updateParentTask(session, null);

    expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
    expect((await parentTask1.getItem()).deletedTime).toEqual(null);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(null);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(null);
    expect((await task4.getItem()).deletedTime).toEqual(null);
    expect((await task5.getItem()).deletedTime).toEqual(null);

    unpause();

    expect(
        (await deletePromise).actions
            .slice()
            .sort((action1, action2) =>
                defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
            ),
    ).toEqual(
        [
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: parentTask1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task1.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task3.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: actionTime,
                taskId: task4.id,
                taskAction: {type: "Delete"},
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: parentTask1.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 5,
                    removedChildTaskCount: 5,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
            {
                type: "UpdateTask",
                time: [actionTime[0], actionTime[1] + 1],
                taskId: grandParentTask.id,
                taskAction: {
                    type: "UpdateChildrenCounts",
                    addedChildTaskCount: 1,
                    removedChildTaskCount: 1,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                },
            },
        ].sort((action1, action2) =>
            defaultCompareStrings(JSON.stringify(action1), JSON.stringify(action2)),
        ),
    );

    expect((await grandParentTask.getItem()).deletedTime).toEqual(null);
    expect((await parentTask1.getItem()).deletedTime).toEqual(actionTime);
    expect((await parentTask2.getItem()).deletedTime).toEqual(null);
    expect((await task1.getItem()).deletedTime).toEqual(actionTime);
    expect((await task2.getItem()).deletedTime).toEqual(null);
    expect((await task3.getItem()).deletedTime).toEqual(actionTime);
    expect((await task4.getItem()).deletedTime).toEqual(actionTime);
    expect((await task5.getItem()).deletedTime).toEqual(null);
});

test("the delete a task with all its children function has the same effect as committing a delete action", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createdTime = testClock.nowLogical();

    const task1 = await TestTask.create(session, {time: createdTime});
    const task2 = await TestTask.create(session, {time: createdTime});

    const replaceTaskIds = (object: any) => {
        if (object.taskId === task1.id) return {...object, taskId: task2.id};
        return object;
    };

    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());

    const deletedTime = testClock.nowLogical();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1.id,
            taskAction: {type: "Delete"},
        },
    ];

    const {extraActions: extraActions1} = await commitTaskActionTransaction(
        TestTask.action(session),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        TestTask.action(session),
        task2.id,
        deletedTime,
    );

    expect([...actions1, ...extraActions1].map(replaceTaskIds)).toEqual(actions2);

    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
});

test("the delete a task with all its children function has the same effect as committing a delete action when task has a parent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createdTime = testClock.nowLogical();
    const parentUpdatedTime = testClock.nowLogical();

    const parentTask1 = await TestTask.create(session, {time: createdTime});
    const parentTask2 = await TestTask.create(session, {time: createdTime});
    const task1 = await TestTask.create(session, {time: createdTime});
    const task2 = await TestTask.create(session, {time: createdTime});

    await task1.updateParentTask(session, parentTask1, {time: parentUpdatedTime});
    await task2.updateParentTask(session, parentTask2, {time: parentUpdatedTime});

    const replaceTaskIds = (object: any) => {
        if (object.taskId === parentTask1.id) object = {...object, taskId: parentTask2.id};
        if (object.taskId === task1.id) object = {...object, taskId: task2.id};

        if (object.childTaskIds) {
            object = {
                ...object,
                childTaskIds: new Set(
                    Array.from(object.childTaskIds, (id: TaskId) => {
                        if (id === parentTask1.id) return parentTask2.id;
                        if (id === task1.id) return task2.id;
                        return id;
                    }),
                ),
            };
        }

        if (object.parentTaskId?.value === parentTask1.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(
                    parentTask2.id,
                    object.parentTaskId.version,
                ),
            };
        }

        if (object.parentTaskId?.value === task1.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2.id, object.parentTaskId.version),
            };
        }

        return object;
    };

    expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());

    const deletedTime = testClock.nowLogical();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1.id,
            taskAction: {type: "Delete"},
        },
    ];

    const {extraActions: extraActions1} = await commitTaskActionTransaction(
        TestTask.action(session),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        TestTask.action(session),
        task2.id,
        deletedTime,
    );

    expect([...actions1, ...extraActions1].map(replaceTaskIds)).toEqual(actions2);

    expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
});

test("the delete a task with all its children function has the same effect as committing delete actions when task has children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createdTime = testClock.nowLogical();
    const parentUpdatedTime = testClock.nowLogical();

    const task1 = await TestTask.create(session, {time: createdTime});
    const task1a = await TestTask.create(session, {time: createdTime});
    const task1b = await TestTask.create(session, {time: createdTime});
    const task2 = await TestTask.create(session, {time: createdTime});
    const task2a = await TestTask.create(session, {time: createdTime});
    const task2b = await TestTask.create(session, {time: createdTime});

    await task1a.updateParentTask(session, task1, {time: parentUpdatedTime});
    await task1b.updateParentTask(session, task1, {time: parentUpdatedTime});
    await task2a.updateParentTask(session, task2, {time: parentUpdatedTime});
    await task2b.updateParentTask(session, task2, {time: parentUpdatedTime});

    await task1b.updateStatus(session, "Closed", {time: parentUpdatedTime});
    await task2b.updateStatus(session, "Closed", {time: parentUpdatedTime});

    const replaceTaskIds = (object: any) => {
        if (object.taskId === task1.id) object = {...object, taskId: task2.id};
        if (object.taskId === task1a.id) object = {...object, taskId: task2a.id};
        if (object.taskId === task1b.id) object = {...object, taskId: task2b.id};

        if (object.childTaskIds) {
            object = {
                ...object,
                childTaskIds: new Set(
                    Array.from(object.childTaskIds, (id: TaskId) => {
                        if (id === task1.id) return task2.id;
                        if (id === task1a.id) return task2a.id;
                        if (id === task1b.id) return task2b.id;
                        return id;
                    }),
                ),
            };
        }

        if (object.parentTaskId?.value === task1.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2.id, object.parentTaskId.version),
            };
        }

        if (object.parentTaskId?.value === task1a.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2a.id, object.parentTaskId.version),
            };
        }

        if (object.parentTaskId?.value === task1b.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2b.id, object.parentTaskId.version),
            };
        }

        return object;
    };

    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());

    const deletedTime = testClock.nowLogical();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1.id,
            taskAction: {type: "Delete"},
        },
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1a.id,
            taskAction: {type: "Delete"},
        },
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1b.id,
            taskAction: {type: "Delete"},
        },
    ];

    const {extraActions: extraActions1} = await commitTaskActionTransaction(
        TestTask.action(session),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        TestTask.action(session),
        task2.id,
        deletedTime,
    );

    expect(
        [...actions1, ...extraActions1]
            .map(replaceTaskIds)
            .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
    ).toEqual(
        actions2
            .slice()
            .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
    );

    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());
});

test("the delete a task with all its children function has the same effect as committing delete actions when task has a parent and children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createdTime = testClock.nowLogical();
    const parentUpdatedTime = testClock.nowLogical();

    const parentTask1 = await TestTask.create(session, {time: createdTime});
    const parentTask2 = await TestTask.create(session, {time: createdTime});
    const task1 = await TestTask.create(session, {time: createdTime});
    const task1a = await TestTask.create(session, {time: createdTime});
    const task1b = await TestTask.create(session, {time: createdTime});
    const task2 = await TestTask.create(session, {time: createdTime});
    const task2a = await TestTask.create(session, {time: createdTime});
    const task2b = await TestTask.create(session, {time: createdTime});

    await task1.updateParentTask(session, parentTask1, {time: parentUpdatedTime});
    await task2.updateParentTask(session, parentTask2, {time: parentUpdatedTime});
    await task1a.updateParentTask(session, task1, {time: parentUpdatedTime});
    await task1b.updateParentTask(session, task1, {time: parentUpdatedTime});
    await task2a.updateParentTask(session, task2, {time: parentUpdatedTime});
    await task2b.updateParentTask(session, task2, {time: parentUpdatedTime});

    await task1b.updateStatus(session, "Closed", {time: parentUpdatedTime});
    await task2b.updateStatus(session, "Closed", {time: parentUpdatedTime});

    const replaceTaskIds = (object: any) => {
        if (object.taskId === parentTask1.id) object = {...object, taskId: parentTask2.id};
        if (object.taskId === task1.id) object = {...object, taskId: task2.id};
        if (object.taskId === task1a.id) object = {...object, taskId: task2a.id};
        if (object.taskId === task1b.id) object = {...object, taskId: task2b.id};

        if (object.childTaskIds) {
            object = {
                ...object,
                childTaskIds: new Set(
                    Array.from(object.childTaskIds, (id: TaskId) => {
                        if (id === parentTask1.id) return parentTask2.id;
                        if (id === task1.id) return task2.id;
                        if (id === task1a.id) return task2a.id;
                        if (id === task1b.id) return task2b.id;
                        return id;
                    }),
                ),
            };
        }

        if (object.parentTaskId?.value === parentTask1.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(
                    parentTask2.id,
                    object.parentTaskId.version,
                ),
            };
        }

        if (object.parentTaskId?.value === task1.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2.id, object.parentTaskId.version),
            };
        }

        if (object.parentTaskId?.value === task1a.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2a.id, object.parentTaskId.version),
            };
        }

        if (object.parentTaskId?.value === task1b.id) {
            object = {
                ...object,
                parentTaskId: new TaskParentTaskIdRegister(task2b.id, object.parentTaskId.version),
            };
        }

        return object;
    };

    expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());

    const deletedTime = testClock.nowLogical();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1.id,
            taskAction: {type: "Delete"},
        },
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1a.id,
            taskAction: {type: "Delete"},
        },
        {
            type: "UpdateTask",
            time: deletedTime,
            taskId: task1b.id,
            taskAction: {type: "Delete"},
        },
    ];

    const {extraActions: extraActions1} = await commitTaskActionTransaction(
        TestTask.action(session),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        TestTask.action(session),
        task2.id,
        deletedTime,
    );

    expect(
        [...actions1, ...extraActions1]
            .map(replaceTaskIds)
            .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
    ).toEqual(
        actions2
            .slice()
            .sort((a, b) => defaultCompareStrings(JSON.stringify(a), JSON.stringify(b))),
    );

    expect(replaceTaskIds(await parentTask1.getItem())).toEqual(await parentTask2.getItem());
    expect(replaceTaskIds(await task1.getItem())).toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).toEqual(await task2b.getItem());
});

test("gets notes for task without notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    expect(await getTaskNotesContentWithoutReferences(session.action(), task.id)).toEqual(
        expect.objectContaining({
            spaceId: space.id,
            version: 0,
            content: emptyTaskNotesContent,
        }),
    );
});

test("can't get notes for task that doesn't exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(getTaskNotesContent(session.action(), generateId())).rejects.toThrow(
        NotFoundError,
    );

    await expect(
        getTaskNotesContentWithoutReferences(session.action(), generateId()),
    ).rejects.toThrow(NotFoundError);
});

test("can't get notes for task in the wrong space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const task = await TestTask.create(session);
    const collection = await TestTaskCollection.createPublic(session);
    await task.addCollection(session, collection);

    await expect(getTaskNotesContent(otherSession.action(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        getTaskNotesContentWithoutReferences(otherSession.action(), task.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get notes for task in public collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    expect(await getTaskNotesContent(session2.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    expect(await getTaskNotesContentWithoutReferences(session2.action(), task.id)).toEqual(
        expect.objectContaining({
            spaceId: space.id,
            version: 0,
            content: emptyTaskNotesContent,
        }),
    );
});

test("can't get notes for task in private collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPrivate(session1);
    await task.addCollection(session1, collection);

    await expect(getTaskNotesContent(session2.action(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(getTaskNotesContentWithoutReferences(session2.action(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("gets notes as system action", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect(await getTaskNotesContent(space.systemAction(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    expect(await getTaskNotesContentWithoutReferences(space.systemAction(), task.id)).toEqual(
        expect.objectContaining({
            spaceId: space.id,
            version: 0,
            content: emptyTaskNotesContent,
        }),
    );
});

test("can't get notes as the wrong system action", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    await expect(getTaskNotesContent(otherSpace.systemAction(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        getTaskNotesContentWithoutReferences(otherSpace.systemAction(), task.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can update task notes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 2,
        content: {
            doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
            references: emptyContentReferences,
        },
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 2,
        steps: [new ReplaceStep(3, 3, textSlice("c"))],
    });

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 3,
        content: {
            doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("abc")])]),
            references: emptyContentReferences,
        },
    });

    expect(await getTaskNotesContentWithoutReferences(session.action(), task.id)).toEqual(
        expect.objectContaining({
            spaceId: space.id,
            version: 3,
            content: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("abc")])]),
        }),
    );
});

test("can't update task notes that don't exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: generateId(),
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can't update task notes in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const task = await TestTask.create(session);
    const collection = await TestTaskCollection.createPublic(session);
    await task.addCollection(session, collection);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await expect(
        updateTaskNotesContent(otherSession.action(), {
            spaceId: space.id,
            taskId: task.id,
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });
});

test("can update task notes in a public collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await updateTaskNotesContent(session2.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 2,
        content: {
            doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
            references: emptyContentReferences,
        },
    });
});

test("can't update task notes in a private collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPrivate(session1);
    await task.addCollection(session1, collection);

    expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await expect(
        updateTaskNotesContent(session2.action(), {
            spaceId: space.id,
            taskId: task.id,
            version: 0,
            steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getTaskNotesContent(session1.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });
});

test("can't update task notes with the wrong version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await updateTaskNotesContent(session.action(), {
        spaceId: space.id,
        taskId: task.id,
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 2,
        content: {
            doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
            references: emptyContentReferences,
        },
    });

    await expect(
        updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            version: 1,
            steps: [new ReplaceStep(3, 3, textSlice("c"))],
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 2,
        content: {
            doc: schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("ab")])]),
            references: emptyContentReferences,
        },
    });
});

test("can't update task notes with the wrong version when notes are not initialized", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });

    await expect(
        updateTaskNotesContent(session.action(), {
            spaceId: space.id,
            taskId: task.id,
            version: 2,
            steps: [new ReplaceStep(1, 1, textSlice("a"))],
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await getTaskNotesContent(session.action(), task.id)).toEqual({
        spaceId: space.id,
        version: 0,
        content: {
            doc: emptyTaskNotesContent,
            references: emptyContentReferences,
        },
    });
});

test("commits an update name action when the account's name updates", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    const startTime = testClock.nowDate();

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([]);

    expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
    expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

    await updateOurAccountName(TestTask.action(session), newAccountName1);

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

    await updateOurAccountName(TestTask.action(session), newAccountName2);

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

test("doesn't an update name action when the account is in no spaces", async () => {
    const space = await TestSpace.create(context);
    const session = await TestSession.create(await TestAccount.create(context));

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    const startTime = testClock.nowDate();

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([]);

    expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
    expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

    await updateOurAccountName(TestTask.action(session), newAccountName1);

    expect((await session.get()).initialData.name).toEqual(newAccountName1);
    expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([]);

    await updateOurAccountName(TestTask.action(session), newAccountName2);

    expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
    expect((await session.get()).initialData.name).toEqual(newAccountName2);

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([]);
});

test("commits an update name action when the account's name updates to every space the account is in during race condition 1", async () => {
    const space = await TestSpace.create(context);
    const session = await TestSession.create(await TestAccount.create(context));

    const newAccountName = generateId();

    const startTime = testClock.nowDate();

    expect(
        await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
    ).toEqual([]);

    expect((await session.get()).initialData.name).not.toEqual(newAccountName);

    const pausePromise = updateOurAccountNameBeforeExecuteTestCheckpoint.pauseForTest(
        session.account.id,
    );

    const updatePromise = updateOurAccountName(TestTask.action(session), newAccountName);

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

test("commits an update name action when the account's name updates to every space the account is in during race condition 2", async () => {
    const [space1, space2] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const session = await space1.createSession();

    const newAccountName = generateId();

    const startTime = testClock.nowDate();

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

    const updatePromise = updateOurAccountName(TestTask.action(session), newAccountName);

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

test("correctly updates collection task counts on collection for any task action", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection1, collection2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPrivate(session),
        TestTaskCollection.createPrivate(session),
    ]);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task1.addCollection(session, collection1, {time: time1});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time2 = testClock.nowLogical();
    await task2.addCollection(session, collection2, {time: time2});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time2,
        }),
    );

    const time3 = testClock.nowLogical();
    await task3.addCollection(session, collection2, {time: time3});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 2,
            lastTaskAddedTime: time3,
        }),
    );

    await task4.updateStatus(session, "Closed");

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 2,
            lastTaskAddedTime: time3,
        }),
    );

    const time4 = testClock.nowLogical();
    await task4.addCollection(session, collection1, {time: time4});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time4,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 2,
            lastTaskAddedTime: time3,
        }),
    );

    const time5 = testClock.nowLogical();
    await task3.addCollection(session, collection1, {time: time5});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 3,
            openTaskCount: 2,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 2,
            lastTaskAddedTime: time3,
        }),
    );

    await task3.updateStatus(session, "Closed");

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 3,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time3,
        }),
    );

    await task4.updateStatus(session, "Open");

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 3,
            openTaskCount: 2,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time3,
        }),
    );

    await task1.delete(session);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time3,
        }),
    );

    await task2.delete(session);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 0,
            lastTaskAddedTime: time3,
        }),
    );

    const time6 = testClock.nowLogical();
    await task2.undelete(session, {time: time6});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time6,
        }),
    );

    await task2.removeCollection(session, collection2);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 0,
            lastTaskAddedTime: time6,
        }),
    );

    await task3.delete(session);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time5,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: time6,
        }),
    );

    const time7 = testClock.nowLogical();
    await task3.undelete(session, {time: time7});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time7,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 0,
            lastTaskAddedTime: time7,
        }),
    );

    await task3.removeCollection(session, collection2);

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time7,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: time7,
        }),
    );
});

test("correctly updates collection task counts when deleting task and all children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        task4,
        task5,
        task6,
        collection1,
        collection2,
        collection3,
        collection4,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPrivate(session),
        TestTaskCollection.createPrivate(session),
        TestTaskCollection.createPrivate(session),
        TestTaskCollection.createPrivate(session),
    ]);

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();
    const time3 = testClock.nowLogical();
    const time4 = testClock.nowLogical();
    const time5 = testClock.nowLogical();
    const time6 = testClock.nowLogical();

    await runAllPromises([
        task2.updateParentTask(session, task1),
        task3.updateParentTask(session, task2),
        task4.updateParentTask(session, task2),
        task5.updateParentTask(session, task2),
        task6.updateParentTask(session, task4),
        task6.addCollection(session, collection2, {time: time1}),
        task6.addCollection(session, collection3, {time: time2}),
        task2.addCollection(session, collection1, {time: time3}),
        task3.addCollection(session, collection4, {time: time5}),
        task3.updateStatus(session, "Closed"),
    ]);

    // Make sure these run after our other `addCollection()`s so their times are
    // the ones reflected in the collection objects.
    await task1.addCollection(session, collection2, {time: time4});
    await task4.addCollection(session, collection4, {time: time6});

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time3,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 2,
            lastTaskAddedTime: time4,
        }),
    );
    expect(await collection3.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time2,
        }),
    );
    expect(await collection4.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 2,
            openTaskCount: 1,
            lastTaskAddedTime: time6,
        }),
    );

    await deleteTaskAndAllChildren(TestTask.action(session), task2.id, testClock.nowLogical());

    expect(await collection1.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: time3,
        }),
    );
    expect(await collection2.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time4,
        }),
    );
    expect(await collection3.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: time2,
        }),
    );
    expect(await collection4.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: time6,
        }),
    );
});

test("race condition: update collection task count is recognized if it conflicts with another update (count update commits first)", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTaskCollection.createPublic(session2),
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session2.account.id,
    );

    const updatePromise = collection.setPrivateAccessPolicy(session2);
    const {unpause} = await pausePromise;

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time = testClock.nowLogical();
    await task.addCollection(session1, collection, {time});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time,
        }),
    );

    unpause();
    await updatePromise;

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time,
        }),
    );
});

test("race condition: update collection task count is recognized if it conflicts with another update (other update commits first)", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTaskCollection.createPublic(session2),
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
        session1.account.id,
    );

    const time = testClock.nowLogical();
    const updatePromise = task.addCollection(session1, collection, {time});
    const {unpause} = await pausePromise;

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    await collection.setPrivateAccessPolicy(session2);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    unpause();
    await updatePromise;

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time,
        }),
    );
});

test("multiple actions that update collection item count in one transaction", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await task3.updateStatus(session, "Closed");

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task1.addCollection(session, collection, {time: time1});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );

    const time2 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 4,
            openTaskCount: 3,
            lastTaskAddedTime: time2,
        }),
    );
});

test("multiple actions that update collection item count in one transaction and a collection update at the end", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await task3.updateStatus(session, "Closed");

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task1.addCollection(session, collection, {time: time1});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );

    const time2 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateCollection",
            time: time2,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 4,
            openTaskCount: 3,
            lastTaskAddedTime: time2,
        }),
    );
});

test("multiple actions that update collection item count in one transaction and a collection update at the beginning", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await task3.updateStatus(session, "Closed");

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task1.addCollection(session, collection, {time: time1});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );

    const time2 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateCollection",
            time: time2,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 4,
            openTaskCount: 3,
            lastTaskAddedTime: time2,
        }),
    );
});

test("multiple actions that update collection item count in one transaction and a collection update in the middle", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await task3.updateStatus(session, "Closed");

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task1.addCollection(session, collection, {time: time1});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );

    const time2 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateCollection",
            time: time2,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task4.id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 4,
            openTaskCount: 3,
            lastTaskAddedTime: time2,
        }),
    );
});

test("a collection action and an action that indirectly updates collection task counts in the same transaction", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task, collection] = await runAllPromises([
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 0,
            openTaskCount: 0,
            lastTaskAddedTime: null,
        }),
    );

    const time1 = testClock.nowLogical();
    await task.addCollection(session, collection, {time: time1});

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );

    const time2 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task.id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closerId: session.account.id,
                    closedTime: new TaskFilterableTime({
                        absoluteTime: time2,
                        setterTimeZone: defaultTimeZone,
                    }),
                },
            },
        },
        {
            type: "UpdateCollection",
            time: time2,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 0,
            lastTaskAddedTime: time1,
        }),
    );

    const time3 = testClock.nowLogical();
    await commitTaskActionTransaction(TestTask.action(session), space.id, [
        {
            type: "UpdateCollection",
            time: time3,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task.id,
            taskAction: {
                type: "UpdateStatus",
                status: {type: "Open"},
            },
        },
    ]);

    expect(await collection.getItem()).toEqual(
        expect.objectContaining({
            taskCount: 1,
            openTaskCount: 1,
            lastTaskAddedTime: time1,
        }),
    );
});

test("account can remove access from itself", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(TestTask.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: testClock.nowLogical(),
            taskId: task1.id,
            taskAction: {
                type: "RemoveCollection",
                collectionId: collection1.id,
            },
        },
    ]);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself then grant it back with lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ],
        {leaseId},
    );

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
});

test("account can remove access from itself but can't grant it back with an invalid lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId: generateId<TaskActionTransactionLeaseId>()},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself but can't use another account's lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session3),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself but can't grant itself access back with an incompatible action", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1, collection2] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
        TestTaskCollection.createPrivate(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection2.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
        ),
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
        ),
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself but can't grant itself access back with an expired lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    const originalDateNow = Date.now;
    Date.now = () => addDays(new Date(originalDateNow()), 1).getTime();
    try {
        await expect(
            commitTaskActionTransaction(
                TestTask.action(session1),
                space.id,
                [
                    {
                        type: "UpdateTask",
                        time: [Date.now(), 0],
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
                {leaseId},
            ),
        ).rejects.toThrow(
            new PermissionDeniedError('Actor does not have "Edit" access level to task'),
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
    } finally {
        Date.now = originalDateNow;
    }
});

test("won't create lease if committed action doesn't remove access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(TestTask.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: testClock.nowLogical(),
            taskId: task1.id,
            taskAction: {
                type: "RemoveCollection",
                collectionId: collection1.id,
            },
        },
    ]);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can't create lease with actions you aren't allowed to commit", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, task2, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task2.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
                    },
                },
            ],
            {
                createLeaseIfLostAccess: {
                    id: leaseId,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: testClock.nowLogical(),
                            taskId: task2.id,
                            taskAction: {
                                type: "AddCollection",
                                collectionId: collection1.id,
                                orderKey: initialOrderKey,
                            },
                        },
                    ],
                },
            },
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            'Couldn\'t apply lease actions: Actor does not have "Edit" access level to task',
            {cause: new PermissionDeniedError('Actor does not have "Edit" access level to task')},
        ),
    );

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
});

test("account can't remove access from itself then grant it back with lease that has actions in different order", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    const initialOrderTime = testClock.nowLogical();

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateCollectionPosition",
                    collectionId: collection1.id,
                    position: {orderTime: initialOrderTime, orderKey: assertOrderKey("aZZZ")},
                },
            },
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId: collection1.id,
                            position: {
                                orderTime: initialOrderTime,
                                orderKey: initialOrderKey,
                            },
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateCollectionPosition",
                    collectionId: collection1.id,
                    position: {
                        orderTime: initialOrderTime,
                        orderKey: initialOrderKey,
                    },
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
        ),
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {
                            orderTime: initialOrderTime,
                            orderKey: initialOrderKey,
                        },
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
        ),
    );

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {
                            orderTime: initialOrderTime,
                            orderKey: initialOrderKey,
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
        ),
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "UpdateCollectionPosition",
                    collectionId: collection1.id,
                    position: {
                        orderTime: initialOrderTime,
                        orderKey: initialOrderKey,
                    },
                },
            },
        ],
        {leaseId},
    );

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
});

test("account can remove access from itself but can't grant it back if another user has updated the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await task1.updatePriority(session2, "High");

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself but can't grant it back if another user has deleted the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await deleteTaskAndAllChildren(TestTask.action(session2), task1.id, testClock.nowLogical());

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("account can remove access from itself but can't grant it back if another user has updated notes", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.createPublic(session2),
    ]);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");

    await commitTaskActionTransaction(
        TestTask.action(session1),
        space.id,
        [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ],
        {
            createLeaseIfLostAccess: {
                id: leaseId,
                actions: [
                    {
                        type: "UpdateTask",
                        time: testClock.nowLogical(),
                        taskId: task1.id,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collection1.id,
                            orderKey: initialOrderKey,
                        },
                    },
                ],
            },
        },
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(
        commitTaskActionTransaction(TestTask.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: task1.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection1.id,
                    orderKey: initialOrderKey,
                },
            },
        ]),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );

    await updateTaskNotesContent(session2.action(), {
        spaceId: space.id,
        taskId: task1.id,
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    await expect(
        commitTaskActionTransaction(
            TestTask.action(session1),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            {leaseId},
        ),
    ).rejects.toThrow(new PermissionDeniedError('Actor does not have "Edit" access level to task'));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("counts notes step count contributions for each account", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(new Map());

    await task.typeNotes(session1, "Adding another sentence.");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(new Map());

    await task.typeNotes(session2, " Yet another sentence.");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(new Map([[session2.account.id, 1]]));

    await task.typeNotes(session3, " A third sentence.");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 1],
            [session3.account.id, 1],
        ]),
    );

    await task.typeNotes(session2, " I'm going to need to get more creative with test data.");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 2],
            [session3.account.id, 1],
        ]),
    );

    await task.typeNotes(session2, " How", {secondText: " much wood"});

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await task.typeNotes(session1, " could a wood", {secondText: " chuck chuck"});

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await task.typeNotes(session2, " if a wood chunk could chunk wood?");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 1],
        ]),
    );

    await task.typeNotes(session3, " Nice.");

    expect(
        await getTaskNotesContentWithoutReferences(session1.action(), task.id).then(item =>
            item.stepCountByNonCreatorAccountId.get(),
        ),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 2],
        ]),
    );
});

test("throws error for users that only have view access when trying to access task comments", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const content1 = createSimpleMessageContent("test1");
    const taskComment = await createTaskComment(context.action(creatorSession), {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    });

    const collection = await TestTaskCollection.createPrivate(creatorSession);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.addCollection(creatorSession, collection);

    await expect(
        getTaskComment(assigneeSession.action(), {
            taskId: task.id,
            commentIndex: taskComment.index,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await task.updateAssignee(creatorSession, assigneeSession);

    const taskCommentIdAndIndex = {
        taskId: task.id,
        commentIndex: taskComment.index,
    };

    await expect(
        getTaskComment(assigneeSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();

    await expect(
        getTaskComment(unauthorizedSession.action(), taskCommentIdAndIndex),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(getTaskComment(viewerSession.action(), taskCommentIdAndIndex)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getTaskComment(commenterSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskComment(editorSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskComment(manageSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskComment(creatorSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentPayload(unauthorizedSession.action(), taskCommentIdAndIndex),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getTaskCommentPayload(viewerSession.action(), taskCommentIdAndIndex),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        getTaskCommentPayload(commenterSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskCommentPayload(editorSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskCommentPayload(manageSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
    await expect(
        getTaskCommentPayload(creatorSession.action(), taskCommentIdAndIndex),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to create task comments", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const content1 = createSimpleMessageContent("test1");
    const taskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const collection = await TestTaskCollection.createPrivate(creatorSession);
    await task.addCollection(creatorSession, collection);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    await expect(
        createTaskComment(assigneeSession.action(), taskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        createTaskComment(unauthorizedSession.action(), taskCommentDetails),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(createTaskComment(viewerSession.action(), taskCommentDetails)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        createTaskComment(commenterSession.action(), taskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        createTaskComment(editorSession.action(), taskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        createTaskComment(manageSession.action(), taskCommentDetails),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to update task comments", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    const content1 = createSimpleMessageContent("test1");
    const taskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const creatorTaskComment = await createTaskComment(
        context.action(creatorSession),
        taskCommentDetails,
    );
    const manageTaskComment = await createTaskComment(
        context.action(manageSession),
        taskCommentDetails,
    );
    const editorTaskComment = await createTaskComment(
        context.action(editorSession),
        taskCommentDetails,
    );
    const commenterTaskComment = await createTaskComment(
        context.action(commenterSession),
        taskCommentDetails,
    );
    const viewerTaskComment = await createTaskComment(
        context.action(viewerSession),
        taskCommentDetails,
    );
    const unauthorizedTaskComment = await createTaskComment(
        context.action(unauthorizedSession),
        taskCommentDetails,
    );
    const assigneeTaskComment = await createTaskComment(
        context.action(assigneeSession),
        taskCommentDetails,
    );

    const updatedContent1 = createSimpleMessageContent("updated test1");
    const updatedCreatorTaskCommentDetails = {
        taskId: task.id,
        commentIndex: creatorTaskComment.index,
        content: updatedContent1,
    };

    const updatedAssigneeTaskCommentDetails = {
        taskId: task.id,
        commentIndex: assigneeTaskComment.index,
        content: updatedContent1,
    };

    const updatedUnauthorizedTaskCommentDetails = {
        taskId: task.id,
        commentIndex: unauthorizedTaskComment.index,
        content: updatedContent1,
    };

    const updatedViewerTaskCommentDetails = {
        taskId: task.id,
        commentIndex: viewerTaskComment.index,
        content: updatedContent1,
    };

    const updatedCommenterTaskCommentDetails = {
        taskId: task.id,
        commentIndex: commenterTaskComment.index,
        content: updatedContent1,
    };

    const updatedEditorTaskCommentDetails = {
        taskId: task.id,
        commentIndex: editorTaskComment.index,
        content: updatedContent1,
    };

    const updatedManageTaskCommentDetails = {
        taskId: task.id,
        commentIndex: manageTaskComment.index,
        content: updatedContent1,
    };

    await expect(
        updateTaskCommentContent(assigneeSession.action(), updatedAssigneeTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(
            unauthorizedSession.action(),
            updatedUnauthorizedTaskCommentDetails,
        ),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(viewerSession.action(), updatedViewerTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(creatorSession.action(), updatedCreatorTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(commenterSession.action(), updatedCommenterTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(editorSession.action(), updatedEditorTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(manageSession.action(), updatedManageTaskCommentDetails),
    ).resolves.not.toBeNull();

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    const secondUpdatedTaskComment = createSimpleMessageContent("updated test2");
    const secondUpdatedCreatorTaskCommentDetails = {
        taskId: task.id,
        commentIndex: creatorTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedAssigneeTaskCommentDetails = {
        taskId: task.id,
        commentIndex: assigneeTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedUnauthorizedTaskCommentDetails = {
        taskId: task.id,
        commentIndex: unauthorizedTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedViewerTaskCommentDetails = {
        taskId: task.id,
        commentIndex: viewerTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedCommenterTaskCommentDetails = {
        taskId: task.id,
        commentIndex: commenterTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedEditorTaskCommentDetails = {
        taskId: task.id,
        commentIndex: editorTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    const secondUpdatedManageTaskCommentDetails = {
        taskId: task.id,
        commentIndex: manageTaskComment.index,
        content: secondUpdatedTaskComment,
    };

    await expect(
        updateTaskCommentContent(assigneeSession.action(), secondUpdatedAssigneeTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(
            unauthorizedSession.action(),
            secondUpdatedUnauthorizedTaskCommentDetails,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        updateTaskCommentContent(viewerSession.action(), secondUpdatedViewerTaskCommentDetails),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        updateTaskCommentContent(creatorSession.action(), secondUpdatedCreatorTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(
            commenterSession.action(),
            secondUpdatedCommenterTaskCommentDetails,
        ),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(editorSession.action(), secondUpdatedEditorTaskCommentDetails),
    ).resolves.not.toBeNull();
    await expect(
        updateTaskCommentContent(manageSession.action(), secondUpdatedManageTaskCommentDetails),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to delete task comments", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);
    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    await task.updateAssignee(creatorSession, assigneeSession);

    const content1 = createSimpleMessageContent("test1");

    const taskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const creatorTaskComment = await createTaskComment(
        context.action(creatorSession),
        taskCommentDetails,
    );

    const manageTaskComment = await createTaskComment(
        context.action(manageSession),
        taskCommentDetails,
    );
    const editorTaskComment = await createTaskComment(
        context.action(editorSession),
        taskCommentDetails,
    );
    const commenterTaskComment = await createTaskComment(
        context.action(commenterSession),
        taskCommentDetails,
    );
    const viewerTaskComment = await createTaskComment(
        context.action(viewerSession),
        taskCommentDetails,
    );
    const unauthorizedTaskComment = await createTaskComment(
        context.action(unauthorizedSession),
        taskCommentDetails,
    );
    const assigneeTaskComment = await createTaskComment(
        context.action(assigneeSession),
        taskCommentDetails,
    );

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await expect(
        deleteTaskComment(assigneeSession.action(), {
            taskId: task.id,
            commentIndex: assigneeTaskComment.index,
        }),
    ).resolves.not.toBeNull();
    await expect(
        deleteTaskComment(commenterSession.action(), {
            taskId: task.id,
            commentIndex: commenterTaskComment.index,
        }),
    ).resolves.not.toBeNull();
    await expect(
        deleteTaskComment(editorSession.action(), {
            taskId: task.id,
            commentIndex: editorTaskComment.index,
        }),
    ).resolves.not.toBeNull();
    await expect(
        deleteTaskComment(manageSession.action(), {
            taskId: task.id,
            commentIndex: manageTaskComment.index,
        }),
    ).resolves.not.toBeNull();
    await expect(
        deleteTaskComment(creatorSession.action(), {
            taskId: task.id,
            commentIndex: creatorTaskComment.index,
        }),
    ).resolves.not.toBeNull();

    await expect(
        deleteTaskComment(unauthorizedSession.action(), {
            taskId: task.id,
            commentIndex: unauthorizedTaskComment.index,
        }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        deleteTaskComment(viewerSession.action(), {
            taskId: task.id,
            commentIndex: viewerTaskComment.index,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("throws error for users that only have view access when trying to get task comments from start", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    const content1 = createSimpleMessageContent("test1");
    const firstTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const content2 = createSimpleMessageContent("test2");
    const secondTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content2,
    };

    const content3 = createSimpleMessageContent("test3");
    const thirdTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content3,
    };

    await createTaskComment(context.action(creatorSession), firstTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), secondTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), thirdTaskCommentDetails);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    await expect(
        getTaskCommentsFromStart(assigneeSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromStart(unauthorizedSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskCommentsFromStart(viewerSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskCommentsFromStart(commenterSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromStart(editorSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromStart(manageSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromStart(creatorSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to get task comments from end", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    const content1 = createSimpleMessageContent("test1");
    const firstTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const content2 = createSimpleMessageContent("test2");
    const secondTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content2,
    };

    const content3 = createSimpleMessageContent("test3");
    const thirdTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content3,
    };

    await createTaskComment(context.action(creatorSession), firstTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), secondTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), thirdTaskCommentDetails);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    await expect(
        getTaskCommentsFromEnd(assigneeSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromEnd(unauthorizedSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskCommentsFromEnd(viewerSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskCommentsFromEnd(commenterSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromEnd(editorSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromEnd(manageSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskCommentsFromEnd(creatorSession.action(), {
            taskId: task.id,
            limit: 10,
            afterCommentIndex: 0,
            beforeCommentIndex: 2,
        }),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to get initial task comments", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    const content1 = createSimpleMessageContent("test1");
    const firstTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const content2 = createSimpleMessageContent("test2");
    const secondTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content2,
    };

    const content3 = createSimpleMessageContent("test3");
    const thirdTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content3,
    };

    await createTaskComment(context.action(creatorSession), firstTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), secondTaskCommentDetails);
    await createTaskComment(context.action(creatorSession), thirdTaskCommentDetails);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    await expect(
        getTaskNotesContentAndInitialComments(assigneeSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskNotesContentAndInitialComments(unauthorizedSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskNotesContentAndInitialComments(viewerSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskNotesContentAndInitialComments(commenterSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskNotesContentAndInitialComments(editorSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskNotesContentAndInitialComments(manageSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.not.toBeNull();

    await expect(
        getTaskNotesContentAndInitialComments(creatorSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.not.toBeNull();
});

test("throws error for users that only have view access when trying to get task comments from backfill", async () => {
    const space = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    const content1 = createSimpleMessageContent("test1");
    const firstTaskCommentDetails = {
        taskId: task.id,
        parentCommentIndex: null,
        content: content1,
    };

    const creatorTaskComment = await createTaskComment(
        context.action(creatorSession),
        firstTaskCommentDetails,
    );

    await createTaskComment(context.action(editorSession), firstTaskCommentDetails);

    await createTaskComment(context.action(manageSession), firstTaskCommentDetails);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    expect(
        await backfillTaskComments(creatorSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: null,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: null,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    const updatedMessageContent1 = createSimpleMessageContent("updated test1");
    const updatedFirstTaskCommentDetails = {
        taskId: task.id,
        commentIndex: creatorTaskComment.index,
        content: updatedMessageContent1,
    };

    const updatedCreatorTaskComment = await updateTaskCommentContent(
        creatorSession.action(),
        updatedFirstTaskCommentDetails,
    );

    expect(
        await backfillTaskComments(assigneeSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(manageSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(editorSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(commenterSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    await expect(
        backfillTaskComments(viewerSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        backfillTaskComments(unauthorizedSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdatedTime,
            newCommentLimit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("throws error for users without proper access trying to get the Task Owner", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const [
        unauthorizedSession,
        viewerSession,
        commenterSession,
        editorSession,
        manageSession,
        creatorSession,
        assigneeSession,
    ] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

    const task = await TestTask.create(creatorSession);

    const collection = await TestTaskCollection.createPublic(creatorSession);
    await task.addCollection(creatorSession, collection);

    await collection.updateAccessPolicy(creatorSession, {
        accountGrantById: new Map<AccountId, {level: TaskCollectionAccessLevel}>([
            [creatorSession.account.id, {level: "Manage"}],
            [manageSession.account.id, {level: "Manage"}],
            [editorSession.account.id, {level: "Edit"}],
            [assigneeSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
    });

    await expect(getTaskOwner(creatorSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(manageSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(editorSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(assigneeSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(commenterSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(viewerSession.action(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(unauthorizedSession.action(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(getTaskOwner(space.systemAction(), task.id)).resolves.not.toBeNull();

    await expect(getTaskOwner(otherSpace.systemAction(), task.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("authorizing task access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount, resetCount} = dynamoClientExecuteActionTestCounter.recordForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(3);

        await authorizeTaskAccess(actionContext, task.id, "Edit");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "Edit"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    resetCount();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
        ]);

        expect(getCount()).toEqual(3);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(3);
    }
});

test("authorizing task access as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount, resetCount} = dynamoClientExecuteActionTestCounter.recordForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(1);

        await authorizeTaskAccess(actionContext, task.id, "Edit");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "Edit"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    resetCount();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
        ]);

        expect(getCount()).toEqual(1);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(1);
    }
});

test("authorizing task access after getting task as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount, resetCount} = dynamoClientExecuteActionTestCounter.recordForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getTaskNotesContentAndInitialComments(actionContext, {
            taskId: task.id,
            commentsLimit: 100,
        });

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    resetCount();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getTaskCommentsFromStart(actionContext, {
            taskId: task.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    resetCount();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getTaskCommentsFromEnd(actionContext, {
            taskId: task.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }
});

test("authorizing task access after getting task as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.createPublic(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount, resetCount} = dynamoClientExecuteActionTestCounter.recordForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getTaskNotificationSubscribers(actionContext, task.id);

        expect(getCount()).toEqual(1);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(1);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    resetCount();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getTaskNotesContentAndInitialComments(actionContext, {
            taskId: task.id,
            commentsLimit: 100,
        });

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    resetCount();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getTaskCommentsFromStart(actionContext, {
            taskId: task.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    resetCount();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getTaskCommentsFromEnd(actionContext, {
            taskId: task.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }
});
