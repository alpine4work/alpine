import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {addDays, addHours} from "date-fns";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    updateOurAccountName,
    updateOurAccountNameBeforeExecuteTestCheckpoint,
} from "~/server/accounts/accounts_actions.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {captureAfterTestEndsCallbacks} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {
    acceptSpaceAccountInvite,
    addSpaceAccountForTest,
    getSpaceAccountForTest,
    removeSpaceAccount,
} from "~/server/spaces/spaces_actions.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    authorizeTaskAccess,
    authorizeTaskAccessIfPossible,
    authorizeTaskCollectionAccess,
    authorizeTaskCollectionAccessIfPossible,
    authorizeTaskQueryAccess,
    backfillTaskActionTransactionHistory,
    backfillTaskComments,
    commitTaskActionTransaction,
    commitTaskActionTransactionBeforeExecuteTestCheckpoint,
    createTaskComment,
    deleteTaskAndAllChildren,
    deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint,
    deleteTaskComment,
    getTaskAccessPolicyForBotScope,
    getTaskComment,
    getTaskCommentPayload,
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskNotesContent,
    getTaskNotesContentAndOptionalInitialComments,
    getTaskNotesContentWithoutReferences,
    getTaskNotificationSubscribers,
    getTaskOwnerIfPossible,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyAccountGrant,
} from "~/shared/access/access_policy.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
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
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    createSimpleTaskNotesContent,
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
import {testClock} from "~/shared/test_helpers/test_clock.js";

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

function testAuthorizeTaskQueryAccess(
    context: ServerActionContext,
    options: {
        spaceId: SpaceId;
        filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
    },
) {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: context.actor.type === "Session" ? context.actor.getAccountId() : null,
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
            spaceId: options.spaceId,
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

        const spaceAccount = await getSpaceAccountForTest(
            context.systemAction(space.id),
            otherSpace.id,
            sharedSession.accountId,
        );

        if (spaceAccount?.state.type === "InvitePending") {
            await acceptSpaceAccountInvite(context.action(sharedSession), otherSpace.id);
        }
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
                    creatorId: session.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t create task in space you don’t have access to", async () => {
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

    test("can’t create a task twice", async () => {
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

    test("can’t create a task with the wrong account as the creator", async () => {
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

    test("can’t delete a task that doesn’t exist", async () => {
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

    test("can’t delete a task twice", async () => {
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
        ).rejects.toThrow("Can only view deleted task, access level `Edit` is not allowed");
    });

    test("can’t delete a task with the same time as task creation", async () => {
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

    test("can’t delete a task with a time earlier than task creation", async () => {
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

    test("can’t delete a task with an unreasonable time", async () => {
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

    test("can’t delete a task that’s not yours", async () => {
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

    test("can delete a task that’s in a collection you specifically can edit", async () => {
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

    test("can’t delete a task that’s only in a collection you specifically can view", async () => {
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

    test("can delete a task that’s in a collection you can edit by default", async () => {
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

    test("can’t delete a task that’s only in a collection you can view by default", async () => {
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

    test("can’t delete a task that’s only in a collection space accounts can edit by default if you’re from a different space", async () => {
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

    test("can undelete a task twice if there’s another delete", async () => {
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

    test("can undelete a task twice if there’s another delete in one transaction", async () => {
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

    test("can’t undelete a task twice", async () => {
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

    test("can’t a task that doesn’t exist", async () => {
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

    test("can’t undelete a task with the same time as the deletion time", async () => {
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

    test("can’t undelete a task with a time before the deletion time", async () => {
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

    test("can’t undelete a task with an unreasonable time", async () => {
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

    test("can’t undelete a task that isn’t yours", async () => {
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

    test("can’t undelete a task in a collection you don’t have edit access to", async () => {
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

    test("can update a task’s title", async () => {
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

    test("can update a task’s title in any order", async () => {
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

    test("can’t update a task title for a task that doesn’t exist", async () => {
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

    test("can’t update a deleted task’s title", async () => {
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
        ).rejects.toThrow("Can only view deleted task, access level `Edit` is not allowed");
    });

    test("can’t update a task title that’s not yours", async () => {
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

    test("can update a task’s title that’s in a collection you can edit", async () => {
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

    test("can’t update a task’s title that’s only in a collection you specifically can view", async () => {
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

    test("can’t add a task you don’t have access to to a collection", async () => {
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

    test("can’t add a task to a collection you don’t have access to", async () => {
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

    test("can add a task that’s not yours to a collection", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t add a task to a collection you don’t have edit access to", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t add a task to a collection with an unreasonable update time", async () => {
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

    test("can’t delete a task from a collection with an unreasonable time", async () => {
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

    test("can’t delete a task from a collection you don’t have access to", async () => {
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

    test("can’t delete a task from a collection you don’t have edit access to", async () => {
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

    test("can’t create a collection with no creator", async () => {
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

    test("can’t create a collection with the wrong creator", async () => {
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

    test("can’t create a collection twice", async () => {
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
                        creatorId: session1.account.id,
                        name: "Test",
                        accessPolicy: {
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

    test("can’t create a collection with the wrong account in access policy", async () => {
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

    test("can’t create a collection with an unreasonable created time", async () => {
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

    test("can’t create a collection without our account as a manager", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t delete a collection that doesn’t exist", async () => {
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

    test("can’t delete a collection twice", async () => {
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

    test("can’t delete a collection with the created time", async () => {
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

    test("can’t delete a collection with a time before the created time", async () => {
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

    test("can’t delete a collection with an unreasonable deleted time", async () => {
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

    test("can’t delete a collection you don’t have access to", async () => {
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

    test("can’t delete a collection you only have access to as an editor", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t undelete a collection that doesn’t exist", async () => {
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

    test("can undelete a collection twice if there’s another delete", async () => {
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

    test("can undelete a collection twice if there’s another delete in one transaction", async () => {
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

    test("can’t undelete a collection twice", async () => {
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

    test("can’t undelete a collection with the deleted time", async () => {
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

    test("can’t undelete a collection a time before the deleted time", async () => {
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

    test("can’t undelete a collection with an unreasonable time", async () => {
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

    test("can’t undelete a collection you don’t have access to", async () => {
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

    test("can’t undelete a collection you only have access to as an editor", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can update a collection’s name", async () => {
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

    test("can’t update a collection name for a collection that doesn’t exist", async () => {
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

    test("can’t update a deleted collection’s name", async () => {
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

    test("can’t update a collection name that’s not yours", async () => {
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

    test("can’t update a collection name with an unreasonable time", async () => {
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

    test("can’t update a collection name you don’t have access to", async () => {
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

    test("can’t update a collection name you only have access to as an editor", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can update a collection’s color", async () => {
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

    test("can’t update a collection color for a collection that doesn’t exist", async () => {
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

    test("can’t update a deleted collection’s color", async () => {
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

    test("can’t update a collection color that’s not yours", async () => {
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

    test("can’t update a collection color with an unreasonable time", async () => {
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

    test("can’t update a collection color you don’t have access to", async () => {
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

    test("can’t update a collection color you only have access to as an editor", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can update a collection’s access policy", async () => {
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

    test("can’t update a collection access policy for a collection that doesn’t exist", async () => {
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

    test("can’t update a deleted collection’s access policy", async () => {
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

    test("can’t update a collection access policy that’s not yours", async () => {
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

    test("can’t update a collection access policy with an unreasonable time", async () => {
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

    test("can’t update a collection access policy you don’t have access to", async () => {
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

    test("can’t update a collection access policy you only have access to as an editor", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t update a collection access policy with no manage grants", async () => {
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
        ).rejects.toThrow("Can’t update access policy so that no one has manage access");

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
                            defaultGrant: {level: "Edit"},
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow("Can’t update access policy so that no one has manage access");

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t create task twice race condition", async () => {
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

    test("can’t create collection twice race condition", async () => {
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
                    creatorId: session2.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t update task due date with unreasonable updated time", async () => {
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

    test("can’t update priority with unreasonable updated time", async () => {
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

    test("can’t update task parent with unreasonable update time", async () => {
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

    test("can’t update task parent and parent position with unreasonable time at the same time", async () => {
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

    test("can’t update task parent on a task that doesn’t exist", async () => {
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

    test("can’t update task parent with a task that doesn’t exist", async () => {
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

    test("can’t update task parent to deleted task", async () => {
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

    test("can’t update task parent where grandparent is a deleted task", async () => {
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

    test("can’t update task parent on a task you don’t have edit access to", async () => {
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

    test("can’t update task parent to a task you don’t have edit access to", async () => {
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

    test("can’t update task parent to a task you have view but not edit access to", async () => {
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

    test("child tasks don’t inherit the permissions of their deleted parent task", async () => {
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

    test("child tasks don’t inherit the permissions of their deleted parent task multiple levels up", async () => {
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

    test("child tasks can’t create a circular dependency", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (2 tasks)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (3 tasks)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (5 tasks, scenario 1)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (5 tasks, scenario 2)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (5 tasks, scenario 3)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (5 tasks, scenario 4)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (5 tasks, scenario 5)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can’t create a circular dependency even in race conditions (9 tasks)", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
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
                "Updating task’s `parentTaskId` would create a circular dependency",
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
                "Updating task’s `parentTaskId` would create a circular dependency",
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

    test("can’t create a circular dependency with undelete even in race conditions", async () => {
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
                "Updating task’s `parentTaskId` would create a circular dependency",
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

    test("can remove the parent of a child task when you don’t have access to the parent task", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can change the parent of a child task when you don’t have access to the parent task", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can delete a child task when you don’t have access to the parent task", async () => {
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
                    creatorId: session1.account.id,
                    name: "Test",
                    accessPolicy: {
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

    test("can’t update task parent order key when there is no parent", async () => {
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
        ).rejects.toThrow(new FailedPreconditionError("Task doesn’t have a parent"));
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

    test("can’t update task parent order key with unreasonable updated time", async () => {
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

    test("can’t update task parent order key when parent is deleted", async () => {
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

    test("can’t update task parent order key when you don’t have edit access to parent", async () => {
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

    test("can’t update task parent order key if order time is unreasonable", async () => {
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

    test("can’t update task status with unreasonable updated time", async () => {
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

    test("can’t update task status with unreasonable closed time", async () => {
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

    test("can’t update task status with a closer other than your account", async () => {
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

    test("can’t update task status and assignee status if assignee status has an unreasonable time", async () => {
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

    test("can’t update task assignee with unreasonable updated time", async () => {
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

    test("can’t update task assignee with unreasonable assigned time", async () => {
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

    test("can’t update task assignee with an assigner other than your account", async () => {
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

    test("can’t update task assignee with an assignee outside the current space", async () => {
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
                "Can’t assign a task to an account outside of the current space",
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

    test("can’t update task assignee status with unreasonable updated time", async () => {
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

    test("can’t update task assignee status with unreasonable activated time", async () => {
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

    test("can’t update task assignee position when another account is assigned", async () => {
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
                "Can only update the task’s assignee position if you are the task’s assignee",
            ),
        );
    });

    test("can’t update task assignee position when no account is assigned", async () => {
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
                "Can only update the task’s assignee position if you are the task’s assignee",
            ),
        );
    });

    test("can’t update task assignee position with an account id other than your own", async () => {
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
                "Must use the actor `AccountId` when updating the task’s assignee position",
            ),
        );
    });

    test("can’t update task assignee position with unreasonable order time", async () => {
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

    test("can’t update task assignee and assignee status with unreasonable time at the same time", async () => {
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

    test("can’t update task position with an unreasonable update time", async () => {
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

    test("can’t update task position with an unreasonable order time", async () => {
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

    test("can’t update task position with a task that doesn’t exist", async () => {
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

    test("can’t update task position with a task that’s not in the collection", async () => {
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

    test("can’t update task position with a task that was removed from the collection", async () => {
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

    test("can’t update task position when you don’t have access to the collection", async () => {
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

    test("can’t update task position when you only have view access to the collection", async () => {
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

    test("can’t update a task’s title with an account in a different space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));
    });

    test("can’t update a task’s title in the context of the wrong space", async () => {
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

    test("can’t update a collection’s name with an account in a different space", async () => {
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
        ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));
    });

    test("can’t update a collection’s name in the context of the wrong space", async () => {
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

test("can’t update task in a deleted public collection", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task = await TestTask.create(session1);

    await expect(task.updatePriority(session2, "High")).rejects.toThrow(PermissionDeniedError);

    await task.addCollection(session1, collection);

    await task.updatePriority(session2, "High");

    await collection.delete(session1);

    await expect(task.updatePriority(session2, "Medium")).rejects.toThrow(PermissionDeniedError);

    await collection.undelete(session1);

    await task.updatePriority(session2, "Medium");
});

test("can’t add task to a deleted public collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
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

test("can’t remove task from a deleted public collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
    const task = await TestTask.create(session);

    await task.addCollection(session, collection);

    await collection.delete(session);

    await expect(task.removeCollection(session, collection)).rejects.toThrow(PermissionDeniedError);

    await collection.undelete(session);

    await task.removeCollection(session, collection);
});

test("can’t update collection name in a deleted public collection", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await collection.updateName(session2, "Test 1");

    await collection.delete(session1);

    await expect(collection.updateName(session2, "Test 2")).rejects.toThrow(
        "Task collection was deleted",
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

test("can’t authorize query with no filters", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {spaceId: space.id}),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("authorizes a query with creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
        filters: [
            {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with creator filter if account access was removed", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
        filters: [
            {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session.account.id,
    });

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("doesn’t authorize a query that only excludes creator in filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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

test("can’t authorize a query with other accounts in creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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

test("can’t authorize a query with missing creator filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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
            spaceId: space.id,
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
        spaceId: space.id,
        filters: [
            {type: "Assignee", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with assignee filter if account access was removed", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
        filters: [
            {type: "Assignee", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
        ],
    });

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session.account.id,
    });

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("doesn’t authorize a query that only excludes assignee in filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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

test("can’t authorize a query with other accounts in assignee filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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

test("can’t authorize a query with missing assignee filter", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
            spaceId: space.id,
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
            spaceId: space.id,
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

test("can authorize a query with a collection you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with a collection in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await otherSpace.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).rejects.toThrow("Account doesn’t have access to space");

    await space.addAccount(session2);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: otherSpace.id,
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
    ).rejects.toThrow("Task collection is in the wrong space");

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with a collection you don’t have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can’t authorize an excludes all of query with a collection you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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

test("can’t authorize an is empty collection query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);
    await collection2.access.grantDefault(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection3.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with one of two collections you have access to and one you don’t", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can authorize a query with all of three collections you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection2.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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

test("can’t authorize a query with all of two collections you have access to and one you don’t", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can’t authorize a query with excludes all of three collections you have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection2.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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

test("can’t authorize a query with excludes all of two collections you have access to and one you don’t", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can authorize a query when filtering by a collection you don’t have access to that’s ignored by boolean logic", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
        spaceId: space.id,
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
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can’t authorize is empty collection filter with an accessible collection filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
        spaceId: space.id,
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
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    const collection3 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection2.access.grantDefault(session1);
    await collection3.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
    const collection1 = await TestTaskCollection.create(session1);
    const collection2 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await collection2.access.grantDefault(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
        spaceId: space.id,
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
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });
});

test("can’t authorize a query with a parent filter in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await otherSpace.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await space.addAccount(session2);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: otherSpace.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        }),
    ).rejects.toThrow("Parent task is in the wrong space");

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });
});

test("can’t authorize a query with a parent filter for a task you don’t have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can authorize a query with a parent filter for a task you have access to transitively", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session1);

    await task1.addCollection(session1, collection);
    await task2.updateParentTask(session1, task1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task2.id,
            },
        },
    });
});

test("can’t authorize a query with a parent filter for a task you don’t have access to transitively", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session1);

    await task1.addCollection(session1, collection);
    await task2.updateParentTask(session1, task1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task2.id,
                },
            },
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("can authorize a query with a parent filter for a deleted task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    const task = await TestTask.create(session1);

    await task.addCollection(session1, collection);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });

    await task.delete(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
        filters: {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {
                parentTaskId: task.id,
            },
        },
    });

    await task.undelete(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
            spaceId: space.id,
            sorts: [{type: "ParentPosition", direction: "Ascending", missing: "Last"}],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("Must filter by a parent task to sort by parent position"),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
        spaceId: space.id,
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
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("collection must be in the right space to sort by collection position", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await otherSpace.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: otherSpace.id,
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
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await space.addAccount(session2);

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: otherSpace.id,
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
        }),
    ).rejects.toThrow("Task collection is in the wrong space");

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
});

test("must be allowed to access collection to sort by collection position with collection filter", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);

    await testAuthorizeTaskQueryAccess(session2.action(), {
        spaceId: space.id,
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
            spaceId: space.id,
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));
});

test("must filter by assignee to sort by assignee position", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            sorts: [
                {
                    type: "AssigneePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Must filter assignee to session account to sort by assignee position",
        ),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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
                type: "AssigneePosition",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "AssigneePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Must filter assignee to session account to sort by assignee position",
        ),
    );

    await testAuthorizeTaskQueryAccess(session.action(), {
        spaceId: space.id,
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
                type: "AssigneePosition",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    });

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session.account.id,
    });

    await expect(
        testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
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
                    type: "AssigneePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("must have space access to filter by creator", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const adminSession = await space.createSession({role: "Admin"});

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});
    await otherSpace.addAccount(session1.account);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantUrl(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            },
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");
});

test("must have space access to filter by assigner", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const adminSession = await space.createSession({role: "Admin"});

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});
    await otherSpace.addAccount(session1.account);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantUrl(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(space.id, otherSession.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session1.account.id}],
                    },
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            },
        ),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            },
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");
});

test("must have space access to sort by creator", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const adminSession = await space.createSession({role: "Admin"});

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});
    await otherSpace.addAccount(session1.account);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantUrl(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Creator"}],
        }),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Creator"}],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Creator"}],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Creator"}],
        }),
    ).rejects.toThrow("Unauthenticated session");
});

test("must have space access to sort by assigner", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const adminSession = await space.createSession({role: "Admin"});

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});
    await otherSpace.addAccount(session1.account);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantUrl(session1);

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
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
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session1.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
        }),
    ).resolves.toBeUndefined();

    await expect(
        testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(otherSession.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testAuthorizeTaskQueryAccess(context.anonymousAction(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
            sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
        }),
    ).rejects.toThrow("Unauthenticated session");
});

test("can’t set task as own parent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    await expect(task.updateParentTask(session, task)).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task’s `parentTaskId` would create a circular dependency",
        ),
    );
});

test("can delete a task and all its children when it has no children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    expect(await deleteTaskAndAllChildren(session.action(), task.id, actionTime)).toEqual({
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

test("can’t delete a task and all its children when the task doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const actionTime = testClock.nowLogical();

    await expect(
        deleteTaskAndAllChildren(session.action(), generateId(), actionTime),
    ).rejects.toThrow(NotFoundError);
});

test("can’t delete a task and all its children when you don’t have access to the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    await expect(deleteTaskAndAllChildren(session2.action(), task.id, actionTime)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect((await task.getItem()).deletedTime).toEqual(null);
});

test("can delete a task and all its children when you have access to the task through a collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await task.addCollection(session1, collection);

    await collection.access.set(session1, {
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage", generation: 0}],
            [session3.account.id, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    expect((await task.getItem()).deletedTime).toEqual(null);

    const actionTime = testClock.nowLogical();

    await expect(deleteTaskAndAllChildren(session2.action(), task.id, actionTime)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect((await task.getItem()).deletedTime).toEqual(null);

    expect(await deleteTaskAndAllChildren(session3.action(), task.id, actionTime)).toEqual({
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
        (await deleteTaskAndAllChildren(session.action(), task1.id, actionTime)).actions
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

test("can handle race conditions when deleting a task and all of it’s children", async () => {
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
    const deletePromise = deleteTaskAndAllChildren(session.action(), parentTask1.id, actionTime);

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

test("can handle race conditions when deleting a task with parent and all of it’s children", async () => {
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
    const deletePromise = deleteTaskAndAllChildren(session.action(), parentTask1.id, actionTime);

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
        session.action(),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        session.action(),
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
        session.action(),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        session.action(),
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
        session.action(),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        session.action(),
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
        session.action(),
        space.id,
        actions1,
    );

    expect(replaceTaskIds(await task1.getItem())).not.toEqual(await task2.getItem());
    expect(replaceTaskIds(await task1a.getItem())).not.toEqual(await task2a.getItem());
    expect(replaceTaskIds(await task1b.getItem())).not.toEqual(await task2b.getItem());

    const {actions: actions2} = await deleteTaskAndAllChildren(
        session.action(),
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

test("can’t get notes for task that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(getTaskNotesContent(session.action(), generateId())).rejects.toThrow(
        NotFoundError,
    );

    await expect(
        getTaskNotesContentWithoutReferences(session.action(), generateId()),
    ).rejects.toThrow(NotFoundError);
});

test("can’t get notes for task in the wrong space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const task = await TestTask.create(session);
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
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
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
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

test("can’t get notes for task in private collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
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

test("can’t get notes as the wrong system action", async () => {
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

test("can’t get notes as an anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    await expect(getTaskNotesContent(context.anonymousAction(), task.id)).rejects.toThrow(
        UnauthenticatedError,
    );

    await expect(
        getTaskNotesContentWithoutReferences(context.anonymousAction(), task.id),
    ).rejects.toThrow(UnauthenticatedError);
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

test("can’t update task notes that don’t exist", async () => {
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

test("can’t update task notes in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();

    const task = await TestTask.create(session);
    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);
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
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
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

test("can’t update task notes in a private collection", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
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

test("can’t update task notes with the wrong version", async () => {
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

test("can’t update task notes with the wrong version when notes are not initialized", async () => {
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

test("commits an update name action when the account’s name updates", async () => {
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

test("doesn’t an update name action when the account is in no spaces", async () => {
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

test("commits an update name action when the account’s name updates to every space the account is in during race condition 1", async () => {
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

test("commits an update name action when the account’s name updates to every space the account is in during race condition 2", async () => {
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

test("correctly updates collection task counts on collection for any task action", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection1, collection2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.create(session),
        TestTaskCollection.create(session),
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
        TestTaskCollection.create(session),
        TestTaskCollection.create(session),
        TestTaskCollection.create(session),
        TestTaskCollection.create(session),
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

    await deleteTaskAndAllChildren(session.action(), task2.id, testClock.nowLogical());

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
        TestTaskCollection.create(session2),
    ]);

    await collection.access.grantDefault(session2);

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

    const updatePromise = collection.access.revokeDefault(session2);
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
        TestTaskCollection.create(session2),
    ]);

    await collection.access.grantDefault(session2);

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

    await collection.access.revokeDefault(session2);

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
        TestTaskCollection.create(session),
    ]);

    await collection.access.grantDefault(session);

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
    await commitTaskActionTransaction(session.action(), space.id, [
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
        TestTaskCollection.create(session),
    ]);

    await collection.access.grantDefault(session);

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
    await commitTaskActionTransaction(session.action(), space.id, [
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
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
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
        TestTaskCollection.create(session),
    ]);

    await collection.access.grantDefault(session);

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
    await commitTaskActionTransaction(session.action(), space.id, [
        {
            type: "UpdateCollection",
            time: time2,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
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
        TestTaskCollection.create(session),
    ]);

    await collection.access.grantDefault(session);

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
    await commitTaskActionTransaction(session.action(), space.id, [
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
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
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
        TestTaskCollection.create(session),
    ]);

    await collection.access.grantDefault(session);

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
    await commitTaskActionTransaction(session.action(), space.id, [
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
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
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
    await commitTaskActionTransaction(session.action(), space.id, [
        {
            type: "UpdateCollection",
            time: time3,
            collectionId: collection.id,
            collectionAction: {
                type: "UpdateAccessPolicy",
                accessPolicy: {
                    accountGrantById: new Map([
                        [session.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
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
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("can authorize task with system actor and anonymous actor and impersonated account actor", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    await otherSpace.addAccount(session1);

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
    expect(
        (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(true);

    await expect(authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await expect(authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit")).rejects.toThrow(
        UnauthenticatedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await authorizeTaskAccess(
        context.impersonatedAccountAction(space.id, session1.account.id),
        task1.id,
        "Edit",
    );
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(space.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(true);

    await expect(
        authorizeTaskAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            task1.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to task’s space");
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(false);

    await commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
    expect(
        (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(true);

    await expect(authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await expect(authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit")).rejects.toThrow(
        UnauthenticatedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await expect(
        authorizeTaskAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            task1.id,
            "Edit",
        ),
    ).rejects.toThrow(PermissionDeniedError);
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(space.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(false);

    await expect(
        authorizeTaskAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            task1.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to task’s space");
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(false);

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
    expect(
        (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(true);

    await expect(authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await expect(authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit")).rejects.toThrow(
        UnauthenticatedError,
    );
    expect(
        (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
    ).toEqual(false);

    await expect(
        authorizeTaskAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            task1.id,
            "Edit",
        ),
    ).rejects.toThrow(PermissionDeniedError);
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(space.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(false);

    await expect(
        authorizeTaskAccess(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            task1.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to task’s space");
    expect(
        (
            await authorizeTaskAccessIfPossible(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            )
        )?.ok,
    ).toEqual(false);
});

test("account can remove access from itself then grant it back with lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );
});

test("account can remove access from itself but can’t grant it back with an invalid lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("account can remove access from itself but can’t use another account’s lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(
            session3.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("account can remove access from itself but can’t grant itself access back with an incompatible action", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1, collection2] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
            session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("account can remove access from itself but can’t grant itself access back with an expired lease", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    const originalDateNow = Date.now;
    Date.now = () => addDays(new Date(originalDateNow()), 1).getTime();
    try {
        await expect(
            commitTaskActionTransaction(
                session1.action(),
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
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);
    } finally {
        Date.now = originalDateNow;
    }
});

test("won’t create lease if committed action doesn’t remove access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("can’t create lease with actions you aren’t allowed to commit", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, task2, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
            session1.action(),
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
            "Couldn’t apply lease actions: Actor doesn’t have `Edit` access level",
            {cause: new PermissionDeniedError("Actor doesn’t have `Edit` access level")},
        ),
    );

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );
});

test("account can’t remove access from itself then grant it back with lease that has actions in different order", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    const initialOrderTime = testClock.nowLogical();

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
            session1.action(),
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
            session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );
});

test("account can remove access from itself but can’t grant it back if another user has updated the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await task1.updatePriority(session2, "High");

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("account can remove access from itself but can’t grant it back if another user has deleted the task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await deleteTaskAndAllChildren(session2.action(), task1.id, testClock.nowLogical());

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("account can remove access from itself but can’t grant it back if another user has updated notes", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, collection1] = await runAllPromises([
        TestTask.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session2);

    const leaseId = generateId<TaskActionTransactionLeaseId>();

    await task1.addCollection(session2, collection1);

    await authorizeTaskAccess(session1.action(), task1.id, "Edit");
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    await commitTaskActionTransaction(
        session1.action(),
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await expect(
        commitTaskActionTransaction(session1.action(), space.id, [
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
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    await updateTaskNotesContent(session2.action(), {
        spaceId: space.id,
        taskId: task1.id,
        version: 0,
        steps: [new ReplaceStep(1, 1, textSlice("a")), new ReplaceStep(2, 2, textSlice("b"))],
    });

    await expect(
        commitTaskActionTransaction(
            session1.action(),
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
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("counts notes step count contributions for each account", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
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

    await task.typeNotes(session2, " I’m going to need to get more creative with test data.");

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
        parent: null,
        content: content1,
        fileIds: [],
    });

    const collection = await TestTaskCollection.create(creatorSession);

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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
        parent: null,
        content: content1,
        fileIds: [],
    };

    const collection = await TestTaskCollection.create(creatorSession);
    await task.addCollection(creatorSession, collection);

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    const creatorTaskComment = await task.createComment(creatorSession, "test1");
    const manageTaskComment = await task.createComment(manageSession, "test1");
    const editorTaskComment = await task.createComment(editorSession, "test1");
    const commenterTaskComment = await task.createComment(commenterSession, "test1");
    const viewerTaskComment = await task.createComment(viewerSession, "test1");
    const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
    const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

    const updatedContent1 = createSimpleMessageContent("updated test1");

    await expect(
        assigneeTaskComment.updateContent(assigneeSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        unauthorizedTaskComment.updateContent(unauthorizedSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        viewerTaskComment.updateContent(viewerSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        creatorTaskComment.updateContent(creatorSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        commenterTaskComment.updateContent(commenterSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        editorTaskComment.updateContent(editorSession, updatedContent1),
    ).resolves.not.toBeNull();
    await expect(
        manageTaskComment.updateContent(manageSession, updatedContent1),
    ).resolves.not.toBeNull();

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    const secondUpdatedTaskComment = createSimpleMessageContent("updated test2");

    await expect(
        assigneeTaskComment.updateContent(assigneeSession, secondUpdatedTaskComment),
    ).resolves.not.toBeNull();
    await expect(
        unauthorizedTaskComment.updateContent(unauthorizedSession, secondUpdatedTaskComment),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        viewerTaskComment.updateContent(viewerSession, secondUpdatedTaskComment),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        creatorTaskComment.updateContent(creatorSession, secondUpdatedTaskComment),
    ).resolves.not.toBeNull();
    await expect(
        commenterTaskComment.updateContent(commenterSession, secondUpdatedTaskComment),
    ).resolves.not.toBeNull();
    await expect(
        editorTaskComment.updateContent(editorSession, secondUpdatedTaskComment),
    ).resolves.not.toBeNull();
    await expect(
        manageTaskComment.updateContent(manageSession, secondUpdatedTaskComment),
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
    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    await task.updateAssignee(creatorSession, assigneeSession);

    const creatorTaskComment = await task.createComment(creatorSession, "test1");

    const manageTaskComment = await task.createComment(manageSession, "test1");
    const editorTaskComment = await task.createComment(editorSession, "test1");
    const commenterTaskComment = await task.createComment(commenterSession, "test1");
    const viewerTaskComment = await task.createComment(viewerSession, "test1");
    const unauthorizedTaskComment = await task.createComment(unauthorizedSession, "test1");
    const assigneeTaskComment = await task.createComment(assigneeSession, "test1");

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    await task.createComment(creatorSession, "test1");
    await task.createComment(creatorSession, "test2");
    await task.createComment(creatorSession, "test3");

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    await task.createComment(creatorSession, "test1");
    await task.createComment(creatorSession, "test2");
    await task.createComment(creatorSession, "test3");

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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

test("returns null for users that only have view access when trying to get initial task comments", async () => {
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

    await task.typeNotes(creatorSession, "Test notes");

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    await task.updateAssignee(creatorSession, assigneeSession);

    const comment0 = await task.createComment(creatorSession, "test1");
    const comment1 = await task.createComment(assigneeSession, "test2");
    const comment2 = await task.createComment(creatorSession, "test3");

    await expect(
        getTaskNotesContentAndOptionalInitialComments(assigneeSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: {
            commentCount: 3,
            otherReferencedComments: [],
            lastCommentChangeTime: null,
            comments: [
                new TaskCommentModel({
                    taskId: task.id,
                    index: 0,
                    author: await creatorSession.get(),
                    createdTime: comment0.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 1,
                    author: await assigneeSession.get(),
                    createdTime: comment1.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 2,
                    author: await creatorSession.get(),
                    createdTime: comment2.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
            ],
        },
    });

    await expect(
        getTaskNotesContentAndOptionalInitialComments(unauthorizedSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getTaskNotesContentAndOptionalInitialComments(viewerSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: null,
    });

    await expect(
        getTaskNotesContentAndOptionalInitialComments(commenterSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: {
            commentCount: 3,
            otherReferencedComments: [],
            lastCommentChangeTime: null,
            comments: [
                new TaskCommentModel({
                    taskId: task.id,
                    index: 0,
                    author: await creatorSession.get(),
                    createdTime: comment0.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 1,
                    author: await assigneeSession.get(),
                    createdTime: comment1.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 2,
                    author: await creatorSession.get(),
                    createdTime: comment2.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
            ],
        },
    });

    await expect(
        getTaskNotesContentAndOptionalInitialComments(editorSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: {
            commentCount: 3,
            otherReferencedComments: [],
            lastCommentChangeTime: null,
            comments: [
                new TaskCommentModel({
                    taskId: task.id,
                    index: 0,
                    author: await creatorSession.get(),
                    createdTime: comment0.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 1,
                    author: await assigneeSession.get(),
                    createdTime: comment1.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 2,
                    author: await creatorSession.get(),
                    createdTime: comment2.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
            ],
        },
    });

    await expect(
        getTaskNotesContentAndOptionalInitialComments(manageSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: {
            commentCount: 3,
            otherReferencedComments: [],
            lastCommentChangeTime: null,
            comments: [
                new TaskCommentModel({
                    taskId: task.id,
                    index: 0,
                    author: await creatorSession.get(),
                    createdTime: comment0.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 1,
                    author: await assigneeSession.get(),
                    createdTime: comment1.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 2,
                    author: await creatorSession.get(),
                    createdTime: comment2.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
            ],
        },
    });

    await expect(
        getTaskNotesContentAndOptionalInitialComments(creatorSession.action(), {
            taskId: task.id,
            commentsLimit: 10,
        }),
    ).resolves.toEqual({
        notes: {
            version: 1,
            content: {
                doc: createSimpleTaskNotesContent("Test notes"),
                references: emptyContentReferences,
            },
        },
        initialComments: {
            commentCount: 3,
            otherReferencedComments: [],
            lastCommentChangeTime: null,
            comments: [
                new TaskCommentModel({
                    taskId: task.id,
                    index: 0,
                    author: await creatorSession.get(),
                    createdTime: comment0.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 1,
                    author: await assigneeSession.get(),
                    createdTime: comment1.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test2"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
                new TaskCommentModel({
                    taskId: task.id,
                    index: 2,
                    author: await creatorSession.get(),
                    createdTime: comment2.createdTime,
                    payload: {
                        type: "Content",
                        parent: null,
                        content: {
                            doc: createSimpleMessageContent("test3"),
                            references: emptyContentReferences,
                        },
                        contentUpdate: null,
                        files: [],
                    },
                    stream: null,
                }),
            ],
        },
    });
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

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    const creatorTaskComment = await task.createComment(creatorSession, "test1");

    await task.createComment(editorSession, "test1");

    await task.createComment(manageSession, "test1");

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
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

    const updatedCreatorTaskComment = await creatorTaskComment.updateContent(
        creatorSession,
        updatedMessageContent1,
    );

    expect(
        await backfillTaskComments(assigneeSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(manageSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(editorSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    expect(
        await backfillTaskComments(commenterSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
            newCommentLimit: 100,
        }),
    ).toEqual({
        commentCount: 3,
        lastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
        newComments: [],
        newOtherReferencedComments: [],
        commentChangesResult: {type: "Available", changes: []},
    });

    await expect(
        backfillTaskComments(viewerSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
            newCommentLimit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        backfillTaskComments(unauthorizedSession.action(), {
            taskId: task.id,
            clientCommentCount: 3,
            clientLastCommentChangeTime: updatedCreatorTaskComment.contentUpdate.time,
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

    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await task.addCollection(creatorSession, collection);

    await collection.access.set(creatorSession, {
        accountGrantById: new Map<AccountId, AccessPolicyAccountGrant>([
            [creatorSession.account.id, {level: "Manage", generation: 0}],
            [manageSession.account.id, {level: "Manage", generation: 1}],
            [editorSession.account.id, {level: "Edit"}],
            [assigneeSession.account.id, {level: "Edit"}],
            [commenterSession.account.id, {level: "Comment"}],
            [viewerSession.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });

    await expect(getTaskOwnerIfPossible(creatorSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(manageSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(editorSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(assigneeSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(commenterSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(viewerSession.action(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(unauthorizedSession.action(), task.id)).resolves.toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });

    await expect(getTaskOwnerIfPossible(space.systemAction(), task.id)).resolves.toEqual(
        expect.objectContaining({ok: true}),
    );

    await expect(getTaskOwnerIfPossible(otherSpace.systemAction(), task.id)).resolves.toEqual({
        ok: false,
        error: expect.any(PermissionDeniedError),
    });
});

test("authorizing task access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
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
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccess(actionContext, task.id, "View"),
            authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
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
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getTaskNotesContentAndOptionalInitialComments(actionContext, {
            taskId: task.id,
            commentsLimit: 100,
        });

        expect(getCount()).toEqual(3);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(3);

        await authorizeTaskAccess(actionContext, task.id, "View");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }
});

test("authorizing task access after getting task as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(2);

    const task = await TestTask.create(session1);
    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task.addCollection(session1, collection);

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

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
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }
});

test("can authorize task collections in various states as various actors", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    await otherSpace.addAccount(session1);

    const [
        publicCollection,
        publicDeletedCollection,
        privateCollection,
        privateDeletedCollection,
        urlPublicCollection,
        urlPublicDeletedCollection,
    ] = await runAllPromises([
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
    ]);

    await publicCollection.access.grantDefault(session1);
    await publicDeletedCollection.access.grantDefault(session1);

    await privateCollection.access.grant(session1, session2, "Comment");
    await privateDeletedCollection.access.grant(session1, session2, "Comment");

    await urlPublicCollection.access.grantUrl(session1);
    await urlPublicDeletedCollection.access.grantUrl(session1);

    await publicDeletedCollection.delete(session1);
    await privateDeletedCollection.delete(session1);
    await urlPublicDeletedCollection.delete(session1);

    const authorize = async (
        context: ServerActionContext,
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ) => {
        const result = assertExists(
            await authorizeTaskCollectionAccessIfPossible(
                context,
                collectionId,
                expectedAccessLevel,
            ),
        );

        try {
            await authorizeTaskCollectionAccess(context, collectionId, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await expect(authorize(session1.action(), publicCollection.id, "View")).resolves.not.toThrow();
    await expect(authorize(session2.action(), publicCollection.id, "View")).resolves.not.toThrow();
    await expect(authorize(session3.action(), publicCollection.id, "View")).resolves.not.toThrow();
    await expect(authorize(otherSession.action(), publicCollection.id, "View")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(authorize(context.anonymousAction(), publicCollection.id, "View")).rejects.toThrow(
        "Unauthenticated session",
    );
    await expect(
        authorize(space.systemAction(), publicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(authorize(otherSpace.systemAction(), publicCollection.id, "View")).rejects.toThrow(
        "System actor doesn’t have access to space",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicCollection.id,
            "View",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), publicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), publicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session3.action(), publicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(authorize(otherSession.action(), publicCollection.id, "Comment")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(
        authorize(context.anonymousAction(), publicCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), publicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), publicCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(authorize(session1.action(), publicCollection.id, "Edit")).resolves.not.toThrow();
    await expect(authorize(session2.action(), publicCollection.id, "Edit")).resolves.not.toThrow();
    await expect(authorize(session3.action(), publicCollection.id, "Edit")).resolves.not.toThrow();
    await expect(authorize(otherSession.action(), publicCollection.id, "Edit")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(authorize(context.anonymousAction(), publicCollection.id, "Edit")).rejects.toThrow(
        "Unauthenticated session",
    );
    await expect(
        authorize(space.systemAction(), publicCollection.id, "Edit"),
    ).resolves.not.toThrow();
    await expect(authorize(otherSpace.systemAction(), publicCollection.id, "Edit")).rejects.toThrow(
        "System actor doesn’t have access to space",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicCollection.id,
            "Edit",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicCollection.id,
            "Edit",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicCollection.id,
            "Edit",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), publicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), publicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session3.action(), publicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSession.action(), publicDeletedCollection.id, "View"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), publicDeletedCollection.id, "View"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), publicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), publicDeletedCollection.id, "View"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicDeletedCollection.id,
            "View",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(session2.action(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(session3.action(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(otherSession.action(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(otherSpace.systemAction(), publicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(authorize(session1.action(), publicDeletedCollection.id, "Edit")).rejects.toThrow(
        "Can only view deleted task collection, access level `Edit` is not allowed",
    );
    await expect(authorize(session2.action(), publicDeletedCollection.id, "Edit")).rejects.toThrow(
        "Can only view deleted task collection, access level `Edit` is not allowed",
    );
    await expect(authorize(session3.action(), publicDeletedCollection.id, "Edit")).rejects.toThrow(
        "Can only view deleted task collection, access level `Edit` is not allowed",
    );
    await expect(
        authorize(otherSession.action(), publicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), publicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), publicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(otherSpace.systemAction(), publicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            publicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            publicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            publicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            publicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(authorize(session1.action(), privateCollection.id, "View")).resolves.not.toThrow();
    await expect(authorize(session2.action(), privateCollection.id, "View")).resolves.not.toThrow();
    await expect(authorize(session3.action(), privateCollection.id, "View")).rejects.toThrow(
        "Actor doesn’t have `View` access level",
    );
    await expect(authorize(otherSession.action(), privateCollection.id, "View")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(
        authorize(context.anonymousAction(), privateCollection.id, "View"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), privateCollection.id, "View"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateCollection.id,
            "View",
        ),
    ).rejects.toThrow("Actor doesn’t have `View` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateCollection.id,
            "View",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), privateCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), privateCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(authorize(session3.action(), privateCollection.id, "Comment")).rejects.toThrow(
        "Actor doesn’t have `Comment` access level",
    );
    await expect(authorize(otherSession.action(), privateCollection.id, "Comment")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(
        authorize(context.anonymousAction(), privateCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), privateCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(authorize(session1.action(), privateCollection.id, "Edit")).resolves.not.toThrow();
    await expect(authorize(session2.action(), privateCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(authorize(session3.action(), privateCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(authorize(otherSession.action(), privateCollection.id, "Edit")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(
        authorize(context.anonymousAction(), privateCollection.id, "Edit"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateCollection.id, "Edit"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), privateCollection.id, "Edit"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateCollection.id,
            "Edit",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), privateDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), privateDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(authorize(session3.action(), privateDeletedCollection.id, "View")).rejects.toThrow(
        "Actor doesn’t have `View` access level",
    );
    await expect(
        authorize(otherSession.action(), privateDeletedCollection.id, "View"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), privateDeletedCollection.id, "View"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), privateDeletedCollection.id, "View"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateDeletedCollection.id,
            "View",
        ),
    ).rejects.toThrow("Actor doesn’t have `View` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateDeletedCollection.id,
            "View",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(session2.action(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(session3.action(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(otherSession.action(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(otherSpace.systemAction(), privateDeletedCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(authorize(session1.action(), privateDeletedCollection.id, "Edit")).rejects.toThrow(
        "Can only view deleted task collection, access level `Edit` is not allowed",
    );
    await expect(authorize(session2.action(), privateDeletedCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(authorize(session3.action(), privateDeletedCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(
        authorize(otherSession.action(), privateDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), privateDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), privateDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(otherSpace.systemAction(), privateDeletedCollection.id, "Edit"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            privateDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            privateDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            privateDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            privateDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session3.action(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSession.action(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(context.anonymousAction(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(space.systemAction(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), urlPublicCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();

    await expect(
        authorize(session1.action(), urlPublicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(authorize(session2.action(), urlPublicCollection.id, "Comment")).rejects.toThrow(
        "Actor doesn’t have `Comment` access level",
    );
    await expect(authorize(session3.action(), urlPublicCollection.id, "Comment")).rejects.toThrow(
        "Actor doesn’t have `Comment` access level",
    );
    await expect(
        authorize(otherSession.action(), urlPublicCollection.id, "Comment"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), urlPublicCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), urlPublicCollection.id, "Comment"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), urlPublicCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicCollection.id,
            "Comment",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), urlPublicCollection.id, "Edit"),
    ).resolves.not.toThrow();
    await expect(authorize(session2.action(), urlPublicCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(authorize(session3.action(), urlPublicCollection.id, "Edit")).rejects.toThrow(
        "Actor doesn’t have `Edit` access level",
    );
    await expect(authorize(otherSession.action(), urlPublicCollection.id, "Edit")).rejects.toThrow(
        "Account doesn’t have access to space",
    );
    await expect(
        authorize(context.anonymousAction(), urlPublicCollection.id, "Edit"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), urlPublicCollection.id, "Edit"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), urlPublicCollection.id, "Edit"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicCollection.id,
            "Edit",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), urlPublicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session2.action(), urlPublicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(session3.action(), urlPublicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSession.action(), urlPublicDeletedCollection.id, "View"),
    ).rejects.toThrow("Only space members may read deleted task collections");
    await expect(
        authorize(context.anonymousAction(), urlPublicDeletedCollection.id, "View"),
    ).rejects.toThrow("Only space members may read deleted task collections");
    await expect(
        authorize(space.systemAction(), urlPublicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(otherSpace.systemAction(), urlPublicDeletedCollection.id, "View"),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "View",
        ),
    ).resolves.not.toThrow();

    await expect(
        authorize(session1.action(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(session2.action(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(session3.action(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(otherSession.action(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(otherSpace.systemAction(), urlPublicDeletedCollection.id, "Comment"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow(
        "Can only view deleted task collection, access level `Comment` is not allowed",
    );
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Actor doesn’t have `Comment` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "Comment",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");

    await expect(
        authorize(session1.action(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(session2.action(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(session3.action(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(otherSession.action(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Account doesn’t have access to space");
    await expect(
        authorize(context.anonymousAction(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Unauthenticated session");
    await expect(
        authorize(space.systemAction(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(otherSpace.systemAction(), urlPublicDeletedCollection.id, "Edit"),
    ).rejects.toThrow("System actor doesn’t have access to space");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Can only view deleted task collection, access level `Edit` is not allowed");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session2.account.id),
            urlPublicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(space.id, session3.account.id),
            urlPublicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level");
    await expect(
        authorize(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            urlPublicDeletedCollection.id,
            "Edit",
        ),
    ).rejects.toThrow("Impersonated account actor doesn’t have access to space");
});

describe("`authorizeTaskAccess()`", () => {
    let scenario: Awaited<ReturnType<typeof createScenario>>;
    let runAfterTestEndsCallbacks: () => Promise<void>;

    beforeAll(async () => {
        runAfterTestEndsCallbacks = await captureAfterTestEndsCallbacks(async () => {
            scenario = await createScenario();
        });
    });

    afterAll(async () => {
        await runAfterTestEndsCallbacks();
    });

    async function createScenario() {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(3);

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});

        await otherSpace.addAccount(session1);

        const bot = await TestBot.createAndInstantiate(session1);
        const otherBot = await TestBot.createAndInstantiate(otherSession);

        const [
            publicCollection,
            publicDeletedCollection,
            privateCollection,
            privateDeletedCollection,
            urlPublicCollection,
            urlPublicDeletedCollection,
            publicTask,
            publicDeletedTask,
            privateTask,
            privateDeletedTask,
            urlPublicTask,
            urlPublicDeletedTask,
            personalTask,
            personalDeletedTask,
        ] = await runAllPromises([
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
        ]);

        await publicCollection.access.grantDefault(session1);
        await publicDeletedCollection.access.grantDefault(session1);

        await privateCollection.access.grant(session1, session2, "Comment");
        await privateDeletedCollection.access.grant(session1, session2, "Comment");

        await urlPublicCollection.access.grantUrl(session1);
        await urlPublicDeletedCollection.access.grantUrl(session1);

        await publicTask.addCollection(session1, publicCollection);
        await publicDeletedTask.addCollection(session1, publicDeletedCollection);
        await privateTask.addCollection(session1, privateCollection);
        await privateDeletedTask.addCollection(session1, privateDeletedCollection);
        await urlPublicTask.addCollection(session1, urlPublicCollection);
        await urlPublicDeletedTask.addCollection(session1, urlPublicDeletedCollection);

        await publicDeletedTask.delete(session1);
        await privateDeletedTask.delete(session1);
        await urlPublicDeletedTask.delete(session1);
        await personalDeletedTask.delete(session1);

        return {
            space,
            session1,
            session2,
            session3,
            otherSpace,
            otherSession,
            bot,
            otherBot,
            publicCollection,
            publicDeletedCollection,
            privateCollection,
            privateDeletedCollection,
            urlPublicCollection,
            urlPublicDeletedCollection,
            publicTask,
            publicDeletedTask,
            privateTask,
            privateDeletedTask,
            urlPublicTask,
            urlPublicDeletedTask,
            personalTask,
            personalDeletedTask,
        };
    }

    type ExpectedResult = string | null;

    type SessionName = "session1" | "session2" | "session3" | "otherSession";

    type TaskName =
        | "publicTask"
        | "publicDeletedTask"
        | "privateTask"
        | "privateDeletedTask"
        | "urlPublicTask"
        | "urlPublicDeletedTask"
        | "personalTask"
        | "personalDeletedTask";

    const testCases: Record<
        TaskName,
        Record<
            "View" | "Comment" | "Edit",
            {
                anonymous: ExpectedResult;
                system: {
                    space: ExpectedResult;
                    otherSpace: ExpectedResult;
                };
                session: Record<SessionName, ExpectedResult>;
                impersonatedAccount: {
                    space: Record<"session1" | "session2" | "session3", ExpectedResult>;
                    otherSpace: Record<"session1" | "otherSession", ExpectedResult>;
                };
                bot: {
                    bot: {
                        session: Record<"session1" | "session2" | "session3", ExpectedResult>;
                        task: Record<TaskName, ExpectedResult>;
                    };
                    otherBot: {
                        session: Record<"session1" | "otherSession", ExpectedResult>;
                        task: {};
                    };
                };
            }
        >
    > = {
        publicTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: null,
                        },
                        task: {
                            publicTask: null,
                            publicDeletedTask: null,
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: null,
                        },
                        task: {
                            publicTask: null,
                            publicDeletedTask: null,
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: null,
                        },
                        task: {
                            publicTask: null,
                            publicDeletedTask: null,
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        publicDeletedTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Bot can’t access deleted tasks",
                        },
                        task: {
                            publicTask: "Bot can’t access deleted tasks",
                            publicDeletedTask: "Bot can’t access deleted tasks",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Comment` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Comment` is not allowed",
                    session2: "Can only view deleted task, access level `Comment` is not allowed",
                    session3: "Can only view deleted task, access level `Comment` is not allowed",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session2:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session3:
                            "Can only view deleted task, access level `Comment` is not allowed",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Bot can’t access deleted tasks",
                        },
                        task: {
                            publicTask: "Bot can’t access deleted tasks",
                            publicDeletedTask: "Bot can’t access deleted tasks",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Edit` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Edit` is not allowed",
                    session2: "Can only view deleted task, access level `Edit` is not allowed",
                    session3: "Can only view deleted task, access level `Edit` is not allowed",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: "Can only view deleted task, access level `Edit` is not allowed",
                        session2: "Can only view deleted task, access level `Edit` is not allowed",
                        session3: "Can only view deleted task, access level `Edit` is not allowed",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Bot can’t access deleted tasks",
                        },
                        task: {
                            publicTask: "Bot can’t access deleted tasks",
                            publicDeletedTask: "Bot can’t access deleted tasks",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        privateTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: "Actor doesn’t have `View` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: "Actor doesn’t have `View` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: "Actor doesn’t have `View` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `View` access level",
                            publicDeletedTask: "Actor doesn’t have `View` access level",
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        privateDeletedTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: "Actor doesn’t have `View` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: "Actor doesn’t have `View` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Actor doesn’t have `View` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `View` access level",
                            publicDeletedTask: "Actor doesn’t have `View` access level",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Comment` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Comment` is not allowed",
                    session2: "Can only view deleted task, access level `Comment` is not allowed",
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session2:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Edit` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Edit` is not allowed",
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: "Can only view deleted task, access level `Edit` is not allowed",
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        urlPublicTask: {
            View: {
                anonymous: null,
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: null,
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: null,
                            session3: null,
                        },
                        task: {
                            publicTask: null,
                            publicDeletedTask: null,
                            privateTask: null,
                            privateDeletedTask: null,
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: null,
                            otherSession: null,
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `Comment` access level",
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `Comment` access level",
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `Comment` access level",
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: "Actor doesn’t have `Comment` access level",
                            privateDeletedTask: "Actor doesn’t have `Comment` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        urlPublicDeletedTask: {
            View: {
                anonymous: "Only space members may read deleted tasks",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: null,
                    session3: null,
                    otherSession: "Only space members may read deleted tasks",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Bot can’t access deleted tasks",
                            session3: "Bot can’t access deleted tasks",
                        },
                        task: {
                            publicTask: "Bot can’t access deleted tasks",
                            publicDeletedTask: "Bot can’t access deleted tasks",
                            privateTask: "Bot can’t access deleted tasks",
                            privateDeletedTask: "Bot can’t access deleted tasks",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            otherSession: "Bot can’t access deleted tasks",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Comment` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Comment` is not allowed",
                    session2: "Actor doesn’t have `Comment` access level",
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session2: "Actor doesn’t have `Comment` access level",
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `Comment` access level",
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: "Actor doesn’t have `Comment` access level",
                            privateDeletedTask: "Actor doesn’t have `Comment` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Edit` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Edit` is not allowed",
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: "Can only view deleted task, access level `Edit` is not allowed",
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        personalTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `View` access level",
                    session3: "Actor doesn’t have `View` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `View` access level",
                        session3: "Actor doesn’t have `View` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `View` access level",
                            session3: "Actor doesn’t have `View` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `View` access level",
                            publicDeletedTask: "Actor doesn’t have `View` access level",
                            privateTask: "Actor doesn’t have `View` access level",
                            privateDeletedTask: "Actor doesn’t have `View` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `Comment` access level",
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `Comment` access level",
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `Comment` access level",
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: "Actor doesn’t have `Comment` access level",
                            privateDeletedTask: "Actor doesn’t have `Comment` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: null,
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: null,
                            urlPublicDeletedTask: null,
                            personalTask: null,
                            personalDeletedTask: null,
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
        personalDeletedTask: {
            View: {
                anonymous: "Unauthenticated session",
                system: {
                    space: null,
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: null,
                    session2: "Actor doesn’t have `View` access level",
                    session3: "Actor doesn’t have `View` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: null,
                        session2: "Actor doesn’t have `View` access level",
                        session3: "Actor doesn’t have `View` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `View` access level",
                            session3: "Actor doesn’t have `View` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `View` access level",
                            publicDeletedTask: "Actor doesn’t have `View` access level",
                            privateTask: "Actor doesn’t have `View` access level",
                            privateDeletedTask: "Actor doesn’t have `View` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Comment: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Comment` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Comment` is not allowed",
                    session2: "Actor doesn’t have `Comment` access level",
                    session3: "Actor doesn’t have `Comment` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1:
                            "Can only view deleted task, access level `Comment` is not allowed",
                        session2: "Actor doesn’t have `Comment` access level",
                        session3: "Actor doesn’t have `Comment` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `Comment` access level",
                            session3: "Actor doesn’t have `Comment` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Comment` access level",
                            publicDeletedTask: "Actor doesn’t have `Comment` access level",
                            privateTask: "Actor doesn’t have `Comment` access level",
                            privateDeletedTask: "Actor doesn’t have `Comment` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
            Edit: {
                anonymous: "Unauthenticated session",
                system: {
                    space: "Can only view deleted task, access level `Edit` is not allowed",
                    otherSpace: "System actor doesn’t have access to task’s space",
                },
                session: {
                    session1: "Can only view deleted task, access level `Edit` is not allowed",
                    session2: "Actor doesn’t have `Edit` access level",
                    session3: "Actor doesn’t have `Edit` access level",
                    otherSession: "Account doesn’t have access to space",
                },
                impersonatedAccount: {
                    space: {
                        session1: "Can only view deleted task, access level `Edit` is not allowed",
                        session2: "Actor doesn’t have `Edit` access level",
                        session3: "Actor doesn’t have `Edit` access level",
                    },
                    otherSpace: {
                        session1: "Impersonated account actor doesn’t have access to task’s space",
                        otherSession:
                            "Impersonated account actor doesn’t have access to task’s space",
                    },
                },
                bot: {
                    bot: {
                        session: {
                            session1: "Bot can’t access deleted tasks",
                            session2: "Actor doesn’t have `Edit` access level",
                            session3: "Actor doesn’t have `Edit` access level",
                        },
                        task: {
                            publicTask: "Actor doesn’t have `Edit` access level",
                            publicDeletedTask: "Actor doesn’t have `Edit` access level",
                            privateTask: "Actor doesn’t have `Edit` access level",
                            privateDeletedTask: "Actor doesn’t have `Edit` access level",
                            urlPublicTask: "Bot can’t access deleted tasks",
                            urlPublicDeletedTask: "Bot can’t access deleted tasks",
                            personalTask: "Bot can’t access deleted tasks",
                            personalDeletedTask: "Bot can’t access deleted tasks",
                        },
                    },
                    otherBot: {
                        session: {
                            session1: "Account doesn’t have access to space",
                            otherSession: "Account doesn’t have access to space",
                        },
                        task: {},
                    },
                },
            },
        },
    };

    async function runTest(
        context: ServerActionContext,
        taskId: TaskId,
        expectedAccessLevel: "View" | "Comment" | "Edit",
    ) {
        const result = await authorizeTaskAccessIfPossible(context, taskId, expectedAccessLevel);

        try {
            await authorizeTaskAccess(context, taskId, expectedAccessLevel);
            expect(result?.ok).toEqual(true);
            return null;
        } catch (error) {
            if (error instanceof PermissionDeniedError || error instanceof UnauthenticatedError) {
                expect(result?.ok).toEqual(false);
                expect(result?.error).toEqual(error);
                return error.message;
            } else {
                throw error;
            }
        }
    }

    for (const [taskName, testCases1] of getObjectEntriesWithKeyofType(testCases)) {
        for (const [accessLevel, testCases2] of getObjectEntriesWithKeyofType(testCases1)) {
            {
                const expectedResult = testCases2.anonymous;

                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${taskName} authorized for ${accessLevel} by anonymous actor ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                context.anonymousAction(),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }

            for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases2.session,
            )) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${taskName} authorized for ${accessLevel} by ${sessionName} session actor ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[sessionName].action(),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }

            for (const [spaceName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases2.system,
            )) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${taskName} authorized for ${accessLevel} by ${spaceName} system actor ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[spaceName].systemAction(),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }

            for (const [spaceName, testCases3] of getObjectEntriesWithKeyofType(
                testCases2.impersonatedAccount,
            )) {
                for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
                    testCases3,
                )) {
                    test(
                        // eslint-disable-next-line jest/valid-title
                        quote`${taskName} authorized for ${accessLevel} by ${sessionName} in ${spaceName} impersonated account actor ` +
                            (expectedResult === null ? "is ok" : "throws"),
                        async () => {
                            expect(
                                await runTest(
                                    scenario[spaceName].impersonatedAction(scenario[sessionName]),
                                    scenario[taskName].id,
                                    accessLevel,
                                ),
                            ).toEqual(expectedResult);
                        },
                    );
                }
            }

            for (const [botName, testCases3] of getObjectEntriesWithKeyofType(testCases2.bot)) {
                for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
                    testCases3.session,
                )) {
                    test(
                        // eslint-disable-next-line jest/valid-title
                        quote`${taskName} authorized for ${accessLevel} by ${botName} bot actor with ${sessionName} scope ` +
                            (expectedResult === null ? "is ok" : "throws"),
                        async () => {
                            expect(
                                await runTest(
                                    scenario[botName].action({
                                        type: "Account",
                                        accountId: scenario[sessionName].account.id,
                                    }),
                                    scenario[taskName].id,
                                    accessLevel,
                                ),
                            ).toEqual(expectedResult);
                        },
                    );
                }

                for (const [otherTaskName, expectedResult] of getObjectEntriesWithKeyofType(
                    testCases3.task,
                )) {
                    test(
                        // eslint-disable-next-line jest/valid-title
                        quote`${taskName} authorized for ${accessLevel} by ${botName} bot actor with ${otherTaskName} scope ` +
                            (expectedResult === null ? "is ok" : "throws"),
                        async () => {
                            expect(
                                await runTest(
                                    scenario[botName].action({
                                        type: "Task",
                                        taskId: scenario[otherTaskName].id,
                                    }),
                                    scenario[taskName].id,
                                    accessLevel,
                                ),
                            ).toEqual(expectedResult);
                        },
                    );
                }
            }
        }
    }
});

test("account has access to tasks they create and tasks they’re assigned until they’re removed from the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const [session1, session2] = await space.createSessions(2);

    const task1 = await TestTask.create(session1);

    const task2 = await TestTask.create(session2);
    await task2.updateAssignee(session2, session1);

    await expect(authorizeTaskAccess(session1.action(), task1.id, "View")).resolves.not.toThrow();

    await expect(authorizeTaskAccess(session1.action(), task2.id, "View")).resolves.not.toThrow();

    await expect(
        authorizeTaskAccess(session1.action(), task1.id, "Comment"),
    ).resolves.not.toThrow();

    await expect(
        authorizeTaskAccess(session1.action(), task2.id, "Comment"),
    ).resolves.not.toThrow();

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).resolves.not.toThrow();

    await expect(authorizeTaskAccess(session1.action(), task2.id, "Edit")).resolves.not.toThrow();

    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "View"))?.ok).toEqual(
        true,
    );

    expect((await authorizeTaskAccessIfPossible(session1.action(), task2.id, "View"))?.ok).toEqual(
        true,
    );

    expect(
        (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Comment"))?.ok,
    ).toEqual(true);

    expect(
        (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Comment"))?.ok,
    ).toEqual(true);

    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        true,
    );

    expect((await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Edit"))?.ok).toEqual(
        true,
    );

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session1.account.id,
    });

    await expect(authorizeTaskAccess(session1.action(), task1.id, "View")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    await expect(authorizeTaskAccess(session1.action(), task2.id, "View")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Comment")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    await expect(authorizeTaskAccess(session1.action(), task2.id, "Comment")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    await expect(authorizeTaskAccess(session1.action(), task2.id, "Edit")).rejects.toThrow(
        "Account doesn’t have access to space",
    );

    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "View"))?.ok).toEqual(
        false,
    );

    expect((await authorizeTaskAccessIfPossible(session1.action(), task2.id, "View"))?.ok).toEqual(
        false,
    );

    expect(
        (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Comment"))?.ok,
    ).toEqual(false);

    expect(
        (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Comment"))?.ok,
    ).toEqual(false);

    expect((await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok).toEqual(
        false,
    );

    expect((await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Edit"))?.ok).toEqual(
        false,
    );
});

test("can’t revoke access from a collection manager that invited you", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3a, session3b] = await space.createSessions(4);

    const collection = await TestTaskCollection.create(session1);

    await collection.access.grant(session1, session2);
    await collection.access.grant(session2, session3a);
    await collection.access.grant(session2, session3b);

    await expect(collection.access.revoke(session3a, session2)).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    await expect(collection.access.revoke(session3a, session1)).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    await collection.access.revoke(session3a, session3b);
});

test("can only send share notifications when committing an update access policy action", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const [task, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTaskCollection.create(session1, {name: "Test Collection 1"}),
    ]);

    expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

    await ProcessContextModule.waitForTestTasks();

    expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

    const time1 = testClock.nowLogical();
    await expect(
        commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId: task.id,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.account.id,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: time1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ],
            {
                updateAccessPolicyShareNotification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar1"),
                },
            },
        ),
    ).rejects.toThrow(
        "Can only provide `updateAccessPolicyShareNotification` if there’s an `UpdateAccessPolicy` action in the transaction",
    );

    expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

    await ProcessContextModule.waitForTestTasks();

    expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

    const time2 = testClock.nowLogical();
    await expect(
        commitTaskActionTransaction(
            session1.action(),
            space.id,
            [
                {
                    type: "UpdateCollection",
                    time: time2,
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "buzqax",
                    },
                },
            ],
            {
                updateAccessPolicyShareNotification: {
                    accountIds: [session2.account.id, session3.account.id],
                    content: createSimpleMessageContent("foobar2"),
                },
            },
        ),
    ).rejects.toThrow(
        "Can only provide `updateAccessPolicyShareNotification` if there’s an `UpdateAccessPolicy` action in the transaction",
    );

    expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

    await ProcessContextModule.waitForTestTasks();

    expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([]);

    const time3 = testClock.nowLogical();
    await commitTaskActionTransaction(
        session1.action(),
        space.id,
        [
            {
                type: "UpdateCollection",
                time: time3,
                collectionId: collection.id,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        accountGrantById: new Map([
                            [session1.account.id, {level: "Manage", generation: 0}],
                            [session2.account.id, {level: "Manage", generation: 1}],
                            [session3.account.id, {level: "Manage", generation: 1}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
        ],
        {
            updateAccessPolicyShareNotification: {
                accountIds: [session2.account.id, session3.account.id],
                content: createSimpleMessageContent("foobar3"),
            },
        },
    );

    expect((await collection.getItem()).name.value).toEqual("Test Collection 1");

    await ProcessContextModule.waitForTestTasks();

    expect(jobs.filter(job => job.type === "SendShareNotification")).toEqual([
        {
            type: "SendShareNotification",
            jobId: expect.any(String),
            spaceId: space.id,
            actorAccountId: session1.account.id,
            entityId: `TaskCollection:${collection.id}`,
            notification: {
                accountIds: [session2.account.id, session3.account.id],
                content: createSimpleMessageContent("foobar3"),
            },
        },
    ]);
});

test("can’t create task collection with bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    const {id: botAccountId} = await bot.instantiate(adminSession);

    const accessPolicy: AccessPolicy = {
        accountGrantById: new Map([
            [session.account.id, {level: "Manage", generation: 0}],
            [botAccountId, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(TestTaskCollection.create(session, {access: accessPolicy})).rejects.toThrow(
        "Can’t grant access to a bot account",
    );
});

test("can’t share task collection with bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    const {id: botAccountId} = await bot.instantiate(adminSession);

    const accessPolicy1: AccessPolicy = {
        accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const collection = await TestTaskCollection.create(session, {access: accessPolicy1});

    const invalidAccessPolicy2: AccessPolicy = {
        accountGrantById: new Map([
            [session.account.id, {level: "Manage", generation: 0}],
            [botAccountId, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(collection.access.set(session, invalidAccessPolicy2)).rejects.toThrow(
        "Can’t grant access to a bot account",
    );
});

describe("`getTaskAccessPolicyForBotScope()`", () => {
    test("can get access policy for scoped task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual(
            expect.objectContaining({
                accountGrantById: new Map([
                    [session.account.id, expect.objectContaining({level: "Manage"})],
                ]),
            }),
        );
    });

    test("can’t get access policy for scoped task other than the one scoped", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);
        const otherTask = await TestTask.create(session);
        await otherTask.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Task", taskId: task.id}),
                otherTask.id,
            ),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can’t get access policy with space scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Space"}), task.id),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can’t get access policy with space scope even if task is shared with space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Public"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Space"}), task.id),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can’t get access policy with account scope even if account has access to task", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                botAccount.action({type: "Account", accountId: session.account.id}),
                task.id,
            ),
        ).rejects.toThrow("Can only get access policy for the scoped task");
    });

    test("can’t get access policy for task in different space even if scope declares access", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const otherSession = await otherSpace.createSession({role: "Admin"});
        const otherBotAccount = await TestBot.createAndInstantiate(otherSession);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        const task = await TestTask.create(session);
        await task.addCollection(session, collection);

        await expect(
            getTaskAccessPolicyForBotScope(
                otherBotAccount.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).rejects.toThrow("Account doesn’t have access to space");
    });

    test("can’t get access policy for task which doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);

        const taskId = generateId<TaskId>();

        await expect(
            getTaskAccessPolicyForBotScope(botAccount.action({type: "Task", taskId}), taskId),
        ).rejects.toThrow("Task not found");
    });

    test("default access policy only includes creator", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Edit"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes assignee", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);
        await task.updateAssignee(session1, session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Edit"}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection = await TestTaskCollection.create(session1, {access: "Private"});
        await collection.access.grant(session1, session2);

        await task.addCollection(session1, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections excluding removed collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await task.removeCollection(session1, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections excluding deleted collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await collection2.delete(session1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections including undeleted collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);

        await collection2.delete(session1);
        await collection2.undelete(session1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection at right access level", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection = await TestTaskCollection.create(session1, {access: "Private"});
        await collection.access.grant(session1, session2, "View");

        await task.addCollection(session1, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to collection at max access level across collections", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2, "View");

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session2, "Edit");

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection4.access.grant(session1, session2, "Comment");

        await task.addCollection(session1, collection1);
        await task.addCollection(session1, collection2);
        await task.addCollection(session1, collection3);
        await task.addCollection(session1, collection4);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantDefault(session);

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Manage"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection at correct access level", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantDefault(session, "View");

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant in collection at max access level across collections", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });
    });

    test("access policy excludes default grant from removed collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await task.removeCollection(session, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        });
    });

    test("access policy excludes default grant from deleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await collection2.delete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        });
    });

    test("access policy includes default grant from undeleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantDefault(session, "View");

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});
        await collection2.access.grantDefault(session, "Edit");

        const collection3 = await TestTaskCollection.create(session, {access: "Private"});

        const collection4 = await TestTaskCollection.create(session, {access: "Private"});
        await collection4.access.grantDefault(session, "Comment");

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);
        await task.addCollection(session, collection3);
        await task.addCollection(session, collection4);

        await collection2.delete(session);
        await collection2.undelete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });
    });

    test("access policy includes url grant in collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection = await TestTaskCollection.create(session, {access: "Private"});
        await collection.access.grantUrl(session);

        await task.addCollection(session, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy includes url grant in collection even if only one collection has url grant", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy excludes url grant from removed collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await task.removeCollection(session, collection1);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy excludes url grant from deleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await collection1.delete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy excludes url grant from undeleted collection", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        const task = await TestTask.create(session);

        const collection1 = await TestTaskCollection.create(session, {access: "Private"});
        await collection1.access.grantUrl(session);

        const collection2 = await TestTaskCollection.create(session, {access: "Private"});

        await task.addCollection(session, collection1);
        await task.addCollection(session, collection2);

        await collection1.delete(session);
        await collection1.undelete(session);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([[session.account.id, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        });
    });

    test("access policy includes parent task creator", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const bot = await TestBot.createAndInstantiate(session1);

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const task = await TestTask.create(session2);
        await task.addCollection(session2, collection);

        const parentTask = await TestTask.create(session3);
        await task.updateParentTask(session3, parentTask);

        await task.removeCollection(session2, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task assignee", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3] = await space.createSessions(2);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask = await TestTask.create(session2);
        await parentTask.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task creator recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const collection = await TestTaskCollection.create(session2, {access: "Public"});

        const task = await TestTask.create(session2);
        await task.addCollection(session2, collection);

        const parentTask1 = await TestTask.create(session3);
        await parentTask1.addCollection(session3, collection);
        await task.updateParentTask(session3, parentTask1);

        const parentTask2 = await TestTask.create(session4);
        await parentTask2.addCollection(session4, collection);
        await parentTask1.updateParentTask(session4, parentTask2);

        const parentTask3 = await TestTask.create(session5);
        await parentTask2.updateParentTask(session5, parentTask3);

        await task.removeCollection(session2, collection);
        await parentTask1.removeCollection(session2, collection);
        await parentTask2.removeCollection(session2, collection);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes parent task assignee recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections in task parent", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const parentTask = await TestTask.create(session1);
        await task.updateParentTask(session1, parentTask);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await parentTask.addCollection(session1, collection1);
        await parentTask.addCollection(session1, collection2);
        await parentTask.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes accounts granted access to all attached collections in task parent recursively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session1);

        const parentTask1 = await TestTask.create(session1);
        await task.updateParentTask(session1, parentTask1);

        const parentTask2 = await TestTask.create(session1);
        await parentTask1.updateParentTask(session1, parentTask2);

        const parentTask3 = await TestTask.create(session1);
        await parentTask2.updateParentTask(session1, parentTask3);

        const collection1 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection1.access.grant(session1, session2);

        const collection2 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection2.access.grant(session1, session3);
        await collection2.access.grant(session1, session4);

        const collection3 = await TestTaskCollection.create(session1, {access: "Private"});
        await collection3.access.grant(session1, session5);

        await parentTask1.addCollection(session1, collection1);
        await parentTask2.addCollection(session1, collection2);
        await parentTask3.addCollection(session1, collection3);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage"}],
                [session2.account.id, {level: "Manage"}],
                [session3.account.id, {level: "Manage"}],
                [session4.account.id, {level: "Manage"}],
                [session5.account.id, {level: "Manage"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy doesn’t include grants from deleted parent task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await parentTask2.delete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes grants from undeleted parent task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await parentTask2.delete(session2);
        await parentTask2.undelete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes old grants when task is deleted", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await task.delete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("access policy includes grants when task is undeleted", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const [session2, session3, session4, session5] = await space.createSessions(4);
        const bot = await TestBot.createAndInstantiate(session1);

        const task = await TestTask.create(session2);

        const parentTask1 = await TestTask.create(session2);
        await parentTask1.updateAssignee(session2, session3);
        await task.updateParentTask(session2, parentTask1);

        const parentTask2 = await TestTask.create(session2);
        await parentTask2.updateAssignee(session2, session4);
        await parentTask1.updateParentTask(session2, parentTask2);

        const parentTask3 = await TestTask.create(session2);
        await parentTask3.updateAssignee(session2, session5);
        await parentTask2.updateParentTask(session2, parentTask3);

        await task.delete(session2);
        await task.undelete(session2);

        expect(
            await getTaskAccessPolicyForBotScope(
                bot.action({type: "Task", taskId: task.id}),
                task.id,
            ),
        ).toEqual({
            accountGrantById: new Map([
                [session2.account.id, {level: "Edit"}],
                [session3.account.id, {level: "Edit"}],
                [session4.account.id, {level: "Edit"}],
                [session5.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });
    });
});
