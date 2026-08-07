import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {backfillTaskActionTransactionHistoryTestCounter} from "~/server/tasks/data/backfill_task_action_transaction_history_test_counter.js";
import {getTaskQueryNormalizedSortCursorForIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_for_index_doc.js";
import {
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionBeforeUpdateTestCheckpoint,
    indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint,
    queryTaskIndex,
    queryTaskIndexTestCounter,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {getTaskWithoutDependenciesForRealtime} from "~/server/tasks/realtime/get_task_without_dependencies_for_realtime.js";
import {taskRealtimeStoreBeforeLoadTaskTestCheckpoint} from "~/server/tasks/realtime/task_realtime_store.js";
import {
    TestTaskRealtimeServer,
    waitForIndexActionTransactionsWithoutClearingActionHistory,
} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    TaskQueryNormalizedFilters,
    defaultTaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    defaultTaskQueryNormalizedSorts,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";

const context = createTestContext({
    shouldStartOpensearch: true,
    spacesInjection,
    tasksInjection,
});

async function testQueryTaskIndex(
    space: TestSpace,
    {
        filters = defaultTaskQueryNormalizedFilters,
        sorts = defaultTaskQueryNormalizedSorts,
        limit = 100,
        afterCursor = null,
    }: {
        filters?: TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQueryNormalizedSort>;
        limit?: number;
        afterCursor?: TaskIndexDoc | null;
    } = {},
): Promise<Array<TaskIndexDoc>> {
    const tasks = await queryTaskIndex(space.systemAction(), {
        spaceId: space.id,
        filters,
        sorts,
        limit,
        afterCursor: afterCursor
            ? getTaskQueryNormalizedSortCursorForIndexDoc(sorts, afterCursor)
            : null,
    });

    return tasks.map(
        ({
            lastIndexSearchEntityJob,
            approximateActionCountByAccountId,
            titleIndexVersion,
            ...task
        }) => task,
    );
}

test("loads an empty query when no tasks are in the space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });
});

test("getTaskWithoutDependenciesForRealtime dangerouslyAllowDeleted does not include deleted collections", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const deletedCollection = await TestTaskCollection.create(session, {
        access: "Public",
        name: "Deleted Collection",
    });
    const activeCollection = await TestTaskCollection.create(session, {
        access: "Public",
        name: "Active Collection",
    });
    const task = await TestTask.create(session, {
        collections: [deletedCollection, activeCollection],
        title: "Deleted Task",
    });
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([deletedCollection.delete(session), task.delete(session)]);
    await server.wait();

    const {taskResult} = await getTaskWithoutDependenciesForRealtime(session.action(), {
        server: server.server,
        dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
        spaceId: space.id,
        taskId: task.id,
        consistency: "StrongWithinCache",
        dangerouslyAllowDeleted: true,
    });

    expect(
        taskResult?.ok
            ? {
                  isDeleted: taskResult.value.isDeleted(),
                  collectionIds: taskResult.value
                      .getCollections()
                      .getArray()
                      .map(collection => collection.collectionId),
              }
            : taskResult,
    ).toEqual({isDeleted: true, collectionIds: [activeCollection.id]});
});

test("loads a query with one task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const task = await TestTask.create(session);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [await task.getIndexDoc()],
    });
});

test("loads a query with three tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("access policy updates are indexed for queries", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const task = await TestTask.create(session1);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    const initialDoc = await task.getIndexDoc();
    expect(initialDoc.accessPolicy).toBeNull();

    await task.access.grant(session1, session2, "View");
    await server.wait();

    const updatedDoc = await task.getIndexDoc();
    expect(updatedDoc.accessPolicy?.value).toEqual({
        type: "Local",
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage", generation: 0}],
            [session2.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    });
});

test("loadQueries authorizes tasks shared via access policy", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const server = new TestTaskRealtimeServer(context);

    const task1 = await TestTask.create(session1);

    const loadQueries = async () =>
        await server.action(session2).tasks.loadQueries(space.id, {
            queries: [],
            taskIds: [task1.id],
            collectionIds: [],
        });

    await expect(loadQueries()).rejects.toThrow(PermissionDeniedError);

    await task1.access.grant(session1, session2, "View");
    await server.wait();

    const result = await loadQueries();
    const backfillById = new Map(
        result.updateEvent.backfillTasks.map(task => [
            task.type === "Authorized" ? task.task.id : task.taskId,
            task,
        ]),
    );

    expect(backfillById.get(task1.id)?.type).toEqual("Authorized");

    await task1.access.revoke(session1, session2);
    await server.wait();

    await expect(loadQueries()).rejects.toThrow(PermissionDeniedError);
});

test("can\u2019t load a query as the wrong space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await expect(
        server.server.loadQuery(otherSpace.systemAction(), {
            spaceId: session.space.id,
            filters: defaultTaskQueryNormalizedFilters,
            sorts: defaultTaskQueryNormalizedSorts,
            limit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await expect(
        server.server.loadQuery(otherSpace.systemAction(), {
            spaceId: session.space.id,
            filters: defaultTaskQueryNormalizedFilters,
            sorts: defaultTaskQueryNormalizedSorts,
            limit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can\u2019t apply an action transaction as the wrong space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await expect(
        server.server.applyActionTransaction(otherSpace.systemAction(), {
            spaceId: session.space.id,
            committedTime: new Date(),
            actions: [],
            clientId: null,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await server.server.applyActionTransaction(space.systemAction(), {
        spaceId: session.space.id,
        committedTime: new Date(),
        actions: [],
        clientId: null,
    });
});

test("reuses a loaded query with three tasks", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 1})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("can query multiple spaces", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const {getCount: getCount1} = queryTaskIndexTestCounter.recordForTest(space1.id);
    const {getCount: getCount2} = queryTaskIndexTestCounter.recordForTest(space2.id);
    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount1()).toEqual(0);
    expect(getCount2()).toEqual(0);

    expect(await server.loadQuery(session1, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(0);

    expect(await server.loadQuery(session2, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(1);

    expect(await server.loadQuery(session1, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(await server.loadQuery(session2, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(1);
});

test("reuses a loaded query with slightly different but equivalent filters", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session1),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session1.account.id},
                            {type: "Account", accountId: session2.account.id},
                        ],
                    },
                },
            ],
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session2.account.id},
                            {type: "Account", accountId: session1.account.id},
                        ],
                    },
                },
            ],
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("loads up to the limit even when reusing a query", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 10})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("has more tasks is true when loading a subset of a reused query", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("will load with a limit of zero", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(2);
});

test("will load with a limit of zero when there are no tasks", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);
});

test("will load with a limit of zero to discover there are no more tasks", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session, {
            limit: 0,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            limit: 0,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(2);

    await task4.updatePriority(session, "Urgent");
    await server.wait();

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            limit: 0,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);

    expect(
        await server.loadQuery(session, {
            limit: 0,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Urgent"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(3);
});

test("will load with a negative limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: -1})).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });
});

test("won\u2019t load with a non-integer limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await expect(server.loadQuery(session, {limit: 2.17})).rejects.toThrow();
});

test("will dedupe parallel loads (scenario 1)", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await runAllPromises([
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 5}),
            server.loadQuery(session, {limit: 3}),
        ]),
    ).toEqual([
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
                task4.getIndexDoc(),
                task5.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
    ]);

    expect(getCount()).toEqual(2);
});

test("will dedupe parallel loads (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await runAllPromises([
            server.loadQuery(session, {limit: 5}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
        ]),
    ).toEqual([
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
                task4.getIndexDoc(),
                task5.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
    ]);

    expect(getCount()).toEqual(1);
});

test("will backfill action history to load a query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {getCount} = backfillTaskActionTransactionHistoryTestCounter.recordForTest(space.id);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task3, task4] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.waitForApplyActionTransactions();

    expect(await testQueryTaskIndex(space)).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("will backfill action history to load a query and catch up a query with partial results", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {getCount} = backfillTaskActionTransactionHistoryTestCounter.recordForTest(space.id);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);
    await waitForIndexActionTransactionsWithoutClearingActionHistory(context);
    const [task3, task4] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task5, task6] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.waitForApplyActionTransactions();

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 6})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("can load an empty task array when there are still more visible tasks in the query", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(getCount()).toEqual(2);

    await task3.updateStatus(session, "Closed");
    await server.waitForIndexActionTransactions();

    expect(getCount()).toEqual(2);

    const [task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(2);

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(getCount()).toEqual(3);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(4);
});

test("may not return enough tasks to meet the limit when index is behind", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    await task3.updateStatus(session, "Closed");
    await task4.updateStatus(session, "Closed");
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(2);

    await server.wait();

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("pagination cursor is maintained even if the underlying item moves", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
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
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
            limit: 4,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    const oldTask6IndexDoc = await task6.getIndexDoc();

    await task6.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(1);

    expect(
        await testQueryTaskIndex(space, {
            sorts: normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]),
        }),
    ).toEqual(
        await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            oldTask6IndexDoc,
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    );

    expect(getCount()).toEqual(2);

    expect(await task6.getIndexDoc()).not.toEqual(oldTask6IndexDoc);

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("pagination cursor is maintained even if the underlying item moves and index updates", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
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
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);

    const server = new TestTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
            limit: 4,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    const oldTask6IndexDoc = await task6.getIndexDoc();

    await task6.updatePriority(session, "Low");
    await server.wait();

    expect(getCount()).toEqual(1);

    expect(
        await testQueryTaskIndex(space, {
            sorts: normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]),
        }),
    ).toEqual(
        await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    );

    expect(getCount()).toEqual(2);

    expect(await task6.getIndexDoc()).not.toEqual(oldTask6IndexDoc);

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("can load while server receiving action transactions is delayed (scenario 1)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    server.pauseApplyActionTransactions();

    // Ensure action history without caching our test query...
    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.waitForIndexActionTransactions();

    const [task3] = await runAllPromises([TestTask.create(session)]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    await server.waitForIndexActionTransactions();

    const [task4] = await runAllPromises([TestTask.create(session)]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });
});

test("can load while server receiving action transactions is delayed (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);
    server.pauseApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.waitForIndexActionTransactions();

    const [task3] = await runAllPromises([TestTask.create(session)]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    await server.waitForIndexActionTransactions();

    const [task4] = await runAllPromises([TestTask.create(session)]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });
});

test("load can\u2019t introduce new task data which moves task outside of loaded range", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "High");
    await server.waitForIndexActionTransactions();

    expect(oldTask2IndexDoc).not.toEqual(await task2.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });
});

test("load can\u2019t introduce new task data which keeps task inside loaded range", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask1IndexDoc = await task1.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await server.waitForIndexActionTransactions();

    expect(oldTask1IndexDoc).not.toEqual(await task1.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task3.getIndexDoc(), task4.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), task3.getIndexDoc()]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });
});

test("load can\u2019t introduce new task data which removes task from query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await server.waitForIndexActionTransactions();

    expect(oldTask2IndexDoc).not.toEqual(await task1.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("load can\u2019t introduce new task data which adds updated task to query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [{type: "Priority", operation: {type: "OneOf", priorities: new Set(["Low"])}}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Medium");
    await server.waitForIndexActionTransactions();

    expect(await task2.getIndexDoc()).not.toEqual(oldTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("load can\u2019t introduce new task data which adds fresh task to query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await task2.updatePriority(session, "Medium");
    await server.waitForIndexActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("load gets task that\u2019s ahead of actions when it\u2019s fresh", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
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
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);

    await server.wait();
    server.pauseApplyActionTransactions();

    const oldTask8IndexDoc = await task8.getIndexDoc();

    await task8.updatePriority(session, "Low");
    await server.waitForIndexActionTransactions();

    expect(oldTask8IndexDoc).not.toEqual(await task8.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });
});

test("load gets old task at old position that\u2019s ahead of actions when already loaded", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
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
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);

    await runAllPromises([
        waitForIndexActionTransactionsWithoutClearingActionHistory(context),
        server.waitForApplyActionTransactions(),
    ]);
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    const oldTask8IndexDoc = await task8.getIndexDoc();

    await task8.updatePriority(session, "Low");
    await waitForIndexActionTransactionsWithoutClearingActionHistory(context);

    expect(oldTask8IndexDoc).not.toEqual(await task8.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            oldTask8IndexDoc,
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await waitForIndexActionTransactionsWithoutClearingActionHistory(context);

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });
});

test("load gets old task at old position that\u2019s ahead of actions when already loaded and clearing action history", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    const oldTask8IndexDoc = await task8.getIndexDoc();

    await task8.updatePriority(session, "Low");
    await server.waitForIndexActionTransactions();

    expect(oldTask8IndexDoc).not.toEqual(await task8.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task7.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });
});

test("load doesn\u2019t put loaded task in already loaded range", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

    await server.wait();

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    const pausePromise = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    await task8.updatePriority(session, "Low");
    const applyActionTransactionPromise = server.waitForApplyActionTransactions();

    const {unpause} = await pausePromise;

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task7.getIndexDoc(),
        ]),
    });

    unpause();
    await applyActionTransactionPromise;

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task7.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task8.getIndexDoc(),
        ]),
    });
});

test("if loaded task is older than store task then query will return store task (scenario 1)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]));
});

test("if loaded task is older than store task then query will return store task (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: true,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "Low"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: true,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );
});

test("if loaded task is older than store task then query will return store task (scenario 3)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "High");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await runAllPromises([
        waitForIndexActionTransactionsWithoutClearingActionHistory(context),
        server.waitForApplyActionTransactions(),
    ]);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            oldTask2IndexDoc,
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("if loaded task is older than store task then query will return store task (scenario 4)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "High");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await server.wait();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(await task2.getIndexDoc()).not.toEqual(oldTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            oldTask2IndexDoc,
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to catch stale data up", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "High");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(await testQueryTaskIndex(space, {limit: 3})).toEqual(
        await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]),
    );

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(await testQueryTaskIndex(space, {limit: 3})).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions that hide tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Urgent");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: true,
                    ifLow: true,
                    ifMedium: false,
                    ifHigh: true,
                    ifUrgent: true,
                },
            },
        }),
    ).toEqual(await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: true,
                    ifLow: true,
                    ifMedium: false,
                    ifHigh: true,
                    ifUrgent: true,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task2.getIndexDoc(), task4.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

// NOTE(calebmer): This test was flaky due to a bug in OpenSearch:
// https://github.com/opensearch-project/OpenSearch/issues/9537
//
// Should be fixed after a Lucene upgrade to 9.8 which happens in OpenSearch 2.12.
// https://github.com/opensearch-project/OpenSearch/blob/97c1bf01ff511c4db74dc8a81045447b009bec29/release-notes/opensearch.release-notes-2.12.0.md
test("after loading tasks we will replay actions that move tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Urgent");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    expect(
        await testQueryTaskIndex(space, {
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks that have already been loaded", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions but won\u2019t add false positive missing tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task2.updateStatus(session, "Closed");
    await task3.updatePriority(session, "Medium");
    await task4.updateStatus(session, "Closed");
    await task5.updatePriority(session, "Medium");

    await server.wait();

    await task2.updateStatus(session, "Open");
    await task4.updateStatus(session, "Open");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions but won\u2019t add false positive missing tasks that were already loaded", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task2.updateStatus(session, "Closed");
    await task3.updatePriority(session, "Medium");
    await task4.updateStatus(session, "Closed");
    await task5.updatePriority(session, "Medium");

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    await task2.updateStatus(session, "Open");
    await task4.updateStatus(session, "Open");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks and works if before we can add task it is added by other means", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    const pausePromise = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const loadPromise = server.loadQuery(session, {
        limit: 3,
        filters: [
            {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium", "High"])}},
        ],
    });

    const {unpause} = await pausePromise;

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task3.updatePriority(session, "High");
    await server.waitForApplyActionTransactions();

    unpause();

    expect(await loadPromise).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks if the task is stale we catch it up", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    const pausePromise = indexTaskActionTransactionBeforeUpdateTestCheckpoint.pauseForTest(
        space.id,
    );
    const updatedTime = testTaskClock.now();
    const updatePromise = task2.updatePriority(session, "High", {time: updatedTime});
    const {unpause} = await pausePromise;
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            getTaskIndexDocIfExistsForTest(context, space.id, task1.id).then(task =>
                omitObject(assertExists(task), [
                    "version",
                    "lastIndexSearchEntityJob",
                    "approximateActionCountByAccountId",
                    "titleIndexVersion",
                ]),
            ),
        ]),
    );

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id).then(task =>
            omitObject(assertExists(task), ["version"]),
        ),
    ).not.toEqual(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
            .then(task =>
                omitObject(assertExists(task), [
                    "version",
                    "lastIndexSearchEntityJob",
                    "approximateActionCountByAccountId",
                    "titleIndexVersion",
                ]),
            )
            .then(task => ({
                ...task,
                priority: task.priority.apply({value: "High", version: updatedTime}),
            })),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            getTaskIndexDocIfExistsForTest(context, space.id, task1.id).then(task =>
                omitObject(assertExists(task), [
                    "version",
                    "lastIndexSearchEntityJob",
                    "approximateActionCountByAccountId",
                    "titleIndexVersion",
                ]),
            ),
            getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
                .then(task =>
                    omitObject(assertExists(task), [
                        "version",
                        "lastIndexSearchEntityJob",
                        "approximateActionCountByAccountId",
                        "titleIndexVersion",
                    ]),
                )
                .then(task => ({
                    ...task,
                    priority: task.priority.apply({value: "High", version: updatedTime}),
                })),
            getTaskIndexDocIfExistsForTest(context, space.id, task3.id).then(task =>
                omitObject(assertExists(task), [
                    "version",
                    "lastIndexSearchEntityJob",
                    "approximateActionCountByAccountId",
                    "titleIndexVersion",
                ]),
            ),
        ]),
    });

    unpause();
    await updatePromise;

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const updatedTime = testTaskClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is hidden", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const updatedTime = testTaskClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });
});

test("task updates in query after change and is shown", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    const updatedTime = testTaskClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is shown when task is loaded", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    const updatedTime = testTaskClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is moved", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    const updatedTime = testTaskClock.now();
    await task2.updatePriority(session, "Low", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "Low", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            expectedTask2IndexDoc,
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("query after creator account name update applied and refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.wait();

    expect((await task1.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect((await task1.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("query after creator account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("query before creator account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: session1.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("update introduces task with creator account name update to query when index is not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await task2.updatePriority(session2, "High");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });

    const pausePromise = indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.pauseForTest(
        session1.account.id,
    );

    await updateOurAccountName(session1.action(), newAccountName);

    const {unpause} = await pausePromise;

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.creator,
    ).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    await task1.updatePriority(session1, "High");

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.creator,
    ).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.creator,
    ).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });

    unpause();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).creator).toEqual({
        accountId: session2.account.id,
        from: null,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("query after closer account name update applied and refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.wait();

    expect((await task1.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect((await task1.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after closer account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query before closer account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: session1.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("update introduces task with closer account name update to query when index is not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await task2.updatePriority(session2, "High");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    const pausePromise = indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.pauseForTest(
        session1.account.id,
    );

    await updateOurAccountName(session1.action(), newAccountName);

    const {unpause} = await pausePromise;

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    await task1.updatePriority(session1, "High");

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.status.value.closer,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    unpause();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).status.value.closer).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after assignee account name update applied and refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.wait();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after accepting invite for new account updates assignee account name", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const {id: accountId} = await admin.inviteEmailAddress(emailAddress);

    const server = new TestTaskRealtimeServer(context);

    const task = await TestTask.create(admin);
    const collection = await TestTaskCollection.create(admin);
    await collection.access.grantDefault(admin);
    await task.addCollection(admin, collection);
    await task.updateAssignee(admin, accountId);

    await server.wait();

    expect(await server.loadQuery(admin)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: accountId,
                            workingAccountName: emailAddress.slice(0, 50),
                            workingAccountNameVersion: -1,
                        },
                    }),
                }),
            }),
        ],
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

    await server.wait();

    expect(await server.loadQuery(admin)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: accountId,
                            workingAccountName: "Anthony Mose",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after accepting invite for existing account updates assignee account name", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const account = await TestAccount.create(context, {name: "Anthony Mose"});
    const emailAddress = await account.createEmailAddress();
    const {id: accountId} = account;

    await admin.inviteEmailAddress(emailAddress);

    const server = new TestTaskRealtimeServer(context);

    const task = await TestTask.create(admin);
    const collection = await TestTaskCollection.create(admin);
    await collection.access.grantDefault(admin);
    await task.addCollection(admin, collection);
    await task.updateAssignee(admin, accountId);

    await server.wait();

    expect(await server.loadQuery(admin)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: accountId,
                            workingAccountName: emailAddress.slice(0, 50),
                            workingAccountNameVersion: -1,
                        },
                    }),
                }),
            }),
        ],
    });

    await acceptSpaceAccountInvite((await TestSession.create(account)).action(), space.id);

    await server.wait();

    expect(await server.loadQuery(admin)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: accountId,
                            workingAccountName: "Anthony Mose",
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after assignee account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query before assignee account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: session1.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("update introduces task with assignee account name update to query when index is not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await task2.updatePriority(session2, "High");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    const pausePromise = indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.pauseForTest(
        session1.account.id,
    );

    await updateOurAccountName(session1.action(), newAccountName);

    const {unpause} = await pausePromise;

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    await task1.updatePriority(session1, "High");

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assignee,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    unpause();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assignee).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after assigner account name update applied and refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.wait();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query after assigner account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query before assigner account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: session1.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("update introduces task with assigner account name update to query when index is not refreshed", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await task2.updatePriority(session2, "High");

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    const pausePromise = indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.pauseForTest(
        session1.account.id,
    );

    await updateOurAccountName(session1.action(), newAccountName);

    const {unpause} = await pausePromise;

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    await task1.updatePriority(session1, "High");

    await server.waitForApplyActionTransactions();

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task1.id, {realtime: true}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task2.id, {realtime: false}))
            ?.assignee.value?.assigner,
    ).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    unpause();
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task1.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session1.account.id,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });

    expect((await task2.getIndexDoc({realtime: false})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc({realtime: true})).assignee.value?.assigner).toEqual({
        accountId: session2.account.id,
        workingAccountName: session2.account.initialName,
        workingAccountNameVersion: 0,
    });

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("query before creator, closer, assignee, and assigner account name update applied but not refreshed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = new TestTaskRealtimeServer(context);

    const task = await TestTask.create(session);

    await task.updateAssignee(session, session);
    await task.updateStatus(session, "Closed");

    await server.wait();

    const newAccountName = generateId();
    expect(session.account.initialName).not.toEqual(newAccountName);

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                creator: {
                    accountId: session.account.id,
                    from: null,
                    workingAccountName: session.account.initialName,
                    workingAccountNameVersion: 0,
                },
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session.account.id,
                            workingAccountName: session.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session.account.id,
                            workingAccountName: session.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                        assigner: {
                            accountId: session.account.id,
                            workingAccountName: session.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await task.getIndexDoc({realtime: false})).toEqual(
        expect.objectContaining({
            id: task.id,
            creator: {
                accountId: session.account.id,
                from: null,
                workingAccountName: session.account.initialName,
                workingAccountNameVersion: 0,
            },
            status: expect.objectContaining({
                value: expect.objectContaining({
                    closer: {
                        accountId: session.account.id,
                        workingAccountName: session.account.initialName,
                        workingAccountNameVersion: 0,
                    },
                }),
            }),
            assignee: expect.objectContaining({
                value: expect.objectContaining({
                    assignee: {
                        accountId: session.account.id,
                        workingAccountName: session.account.initialName,
                        workingAccountNameVersion: 0,
                    },
                    assigner: {
                        accountId: session.account.id,
                        workingAccountName: session.account.initialName,
                        workingAccountNameVersion: 0,
                    },
                }),
            }),
        }),
    );
    expect(await task.getIndexDoc({realtime: true})).toEqual(
        expect.objectContaining({
            id: task.id,
            creator: {
                accountId: session.account.id,
                from: null,
                workingAccountName: newAccountName,
                workingAccountNameVersion: 1,
            },
            status: expect.objectContaining({
                value: expect.objectContaining({
                    closer: {
                        accountId: session.account.id,
                        workingAccountName: newAccountName,
                        workingAccountNameVersion: 1,
                    },
                }),
            }),
            assignee: expect.objectContaining({
                value: expect.objectContaining({
                    assignee: {
                        accountId: session.account.id,
                        workingAccountName: newAccountName,
                        workingAccountNameVersion: 1,
                    },
                    assigner: {
                        accountId: session.account.id,
                        workingAccountName: newAccountName,
                        workingAccountNameVersion: 1,
                    },
                }),
            }),
        }),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task.id,
                creator: {
                    accountId: session.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                        assigner: {
                            accountId: session.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced creator gets correct account name when query is loaded before", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("referenced creator gets correct account name when query is loaded after", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: newAccountName,
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: session2.account.initialName,
                    workingAccountNameVersion: 0,
                },
            }),
        ],
    });
});

test("referenced closer gets correct account name when query is loaded before", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: {type: "Open"},
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: {type: "Open"},
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced closer gets correct account name when query is loaded after", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                status: expect.objectContaining({
                    value: expect.objectContaining({
                        closer: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced assignee gets correct account name when query is loaded before", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: null,
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: null,
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced assignee gets correct account name when query is loaded after", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced assigner gets correct account name when query is loaded before", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: null,
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: null,
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("referenced assigner gets correct account name when query is loaded after", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await server.wait();

    const newAccountName = generateId();
    expect(session1.account.initialName).not.toEqual(newAccountName);
    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    await updateOurAccountName(session1.action(), newAccountName);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await server.waitForApplyActionTransactions();
    await ProcessContextModule.waitForTestTasks();

    expect(await server.loadQuery(session1)).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: newAccountName,
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: session2.account.initialName,
                            workingAccountNameVersion: 0,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("tasks reorder when creator account name changes", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await updateOurAccountName(session1.action(), "a");
    await updateOurAccountName(session2.action(), "b");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Creator"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: "a",
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: "b",
                    workingAccountNameVersion: 1,
                },
            }),
        ],
    });

    await updateOurAccountName(session1.action(), "c");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Creator"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                creator: {
                    accountId: session2.account.id,
                    from: null,
                    workingAccountName: "b",
                    workingAccountNameVersion: 1,
                },
            }),
            expect.objectContaining({
                id: task1.id,
                creator: {
                    accountId: session1.account.id,
                    from: null,
                    workingAccountName: "c",
                    workingAccountNameVersion: 2,
                },
            }),
        ],
    });
});

test("tasks reorder when assignee account name changes", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session2, session1);
    await task2.updateAssignee(session2, session2);

    await updateOurAccountName(session1.action(), "a");
    await updateOurAccountName(session2.action(), "b");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Assignee", missing: "Last"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: "a",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: "b",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), "c");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Assignee", missing: "Last"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session2.account.id,
                            workingAccountName: "b",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assignee: {
                            accountId: session1.account.id,
                            workingAccountName: "c",
                            workingAccountNameVersion: 2,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("tasks reorder when assigner account name changes", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const server = new TestTaskRealtimeServer(context);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session2);
    await collection.access.grantDefault(session2);
    await runAllPromises([
        task1.addCollection(session2, collection),
        task2.addCollection(session2, collection),
    ]);

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session2, session2);

    await updateOurAccountName(session1.action(), "a");
    await updateOurAccountName(session2.action(), "b");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Assigner", missing: "Last"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: "a",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: "b",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
        ],
    });

    await updateOurAccountName(session1.action(), "c");

    await server.wait();

    expect(
        await server.loadQuery(session1, {
            sorts: [{type: "Assigner", missing: "Last"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [
            expect.objectContaining({
                id: task2.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session2.account.id,
                            workingAccountName: "b",
                            workingAccountNameVersion: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                id: task1.id,
                assignee: expect.objectContaining({
                    value: expect.objectContaining({
                        assigner: {
                            accountId: session1.account.id,
                            workingAccountName: "c",
                            workingAccountNameVersion: 2,
                        },
                    }),
                }),
            }),
        ],
    });
});

test("expensively loading after a null cursor only loads additional needed tasks", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 6}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 3).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 5,
            afterCursor: null,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 5).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 4,
            afterCursor: null,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 4).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);
});

test("expensively loading after a cursor immediately returns when the query is fully loaded", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 4}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 10})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises(tasks.map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 10,
            afterCursor: await tasks[1]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises(tasks.slice(2).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);
});

test("expensively loading after an unloaded cursor catches up a small query", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 30}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 5).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            afterCursor: await tasks[19]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(20, 23).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);
});

test(
    "expensively loading after an unloaded cursor catches up a large query",
    async () => {
        const space = await TestSpace.create(context);
        const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
        const session = await space.createSession();
        const tasks = await runAllPromises(
            Array.from({length: 1001}, () => TestTask.create(session)),
        );
        const server = new TestTaskRealtimeServer(context);

        await server.wait();

        expect(
            await server.expensivelyLoadQueryAfterCursor(session, {
                limit: 5,
                afterCursor: await tasks[990]!.getIndexDoc(),
            }),
        ).toEqual({
            hasMoreTasks: true,
            tasks: await runAllPromises(tasks.slice(991, 996).map(task => task.getIndexDoc())),
        });
        expect(getCount()).toEqual(6);
    },
    30 * 1000,
);

test(
    "expensively loading after a loaded cursor reuses the loaded range when it covers the limit",
    async () => {
        const space = await TestSpace.create(context);
        const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
        const session = await space.createSession();
        const tasks = await runAllPromises(
            Array.from({length: 10}, () => TestTask.create(session)),
        );
        const server = new TestTaskRealtimeServer(context);

        await server.wait();

        expect(await server.loadQuery(session, {limit: 8})).toEqual({
            hasMoreTasks: true,
            tasks: await runAllPromises(tasks.slice(0, 8).map(task => task.getIndexDoc())),
        });
        expect(getCount()).toEqual(1);

        expect(
            await server.expensivelyLoadQueryAfterCursor(session, {
                limit: 4,
                afterCursor: await tasks[2]!.getIndexDoc(),
            }),
        ).toEqual({
            hasMoreTasks: true,
            tasks: await runAllPromises(tasks.slice(3, 7).map(task => task.getIndexDoc())),
        });
        expect(getCount()).toEqual(1);
    },
    30 * 1000,
);

test("expensively loading after a loaded cursor loads only the missing limit", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 10}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 5).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 5,
            afterCursor: await tasks[2]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(3, 8).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 1,
            afterCursor: await tasks[7]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(8, 9).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(3);
});

test("expensively loading after the task before the loaded boundary does not load", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 5}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 3).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 1,
            afterCursor: await tasks[1]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(2, 3).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);
});

test("expensively loading after the loaded boundary loads the next task", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 5}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 3).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 1,
            afterCursor: await tasks[2]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(3, 4).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);
});

test("expensively loading after the task just beyond the loaded boundary excludes that cursor", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 6}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 3).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(1);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 1,
            afterCursor: await tasks[3]!.getIndexDoc(),
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(4, 5).map(task => task.getIndexDoc())),
    });
    expect(getCount()).toEqual(2);
});

test("expensively loading after cursors supports the basic pagination pattern", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const tasks = await runAllPromises(Array.from({length: 8}, () => TestTask.create(session)));
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    const page1 = await server.expensivelyLoadQueryAfterCursor(session, {
        limit: 3,
        afterCursor: null,
    });
    expect(page1).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(0, 3).map(task => task.getIndexDoc())),
    });

    const page2 = await server.expensivelyLoadQueryAfterCursor(session, {
        limit: 3,
        afterCursor: assertExists(page1.tasks[2]),
    });
    expect(page2).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises(tasks.slice(3, 6).map(task => task.getIndexDoc())),
    });

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            afterCursor: assertExists(page2.tasks[2]),
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises(tasks.slice(6, 8).map(task => task.getIndexDoc())),
    });
});

test("expensively loading after an old cursor for a task moved much lower", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const sorts = normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]);
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);
    await server.wait();

    const oldTask6IndexDoc = await task6.getIndexDoc();
    const afterCursor = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, oldTask6IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 4,
            sorts,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    await task6.updatePriority(session, "Low");
    await server.wait();

    expect(await task6.getIndexDoc()).not.toEqual(oldTask6IndexDoc);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            sorts,
            afterCursor,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
        ]),
    });
});

test("expensively loading after an old cursor for a task moved a little lower", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const sorts = normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]);
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);
    await server.wait();

    const oldTask5IndexDoc = await task5.getIndexDoc();
    const afterCursor = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, oldTask5IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await task5.updatePriority(session, "Medium");
    await server.wait();

    expect(await task5.getIndexDoc()).not.toEqual(oldTask5IndexDoc);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 4,
            sorts,
            afterCursor,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("expensively loading after an old cursor for a task moved much higher", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const sorts = normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]);
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);
    await server.wait();

    const oldTask3IndexDoc = await task3.getIndexDoc();
    const afterCursor = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, oldTask3IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task3.updatePriority(session, "Urgent");
    await server.wait();

    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            sorts,
            afterCursor,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });
});

test("expensively loading after an old cursor for a task moved a little higher", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const sorts = normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]);
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Medium"),
        task4.updatePriority(session, "Medium"),
        task5.updatePriority(session, "High"),
        task6.updatePriority(session, "High"),
        task7.updatePriority(session, "Urgent"),
        task8.updatePriority(session, "Urgent"),
    ]);
    await server.wait();

    const oldTask4IndexDoc = await task4.getIndexDoc();
    const afterCursor = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, oldTask4IndexDoc);

    expect(
        await server.loadQuery(session, {
            limit: 6,
            sorts,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await task4.updatePriority(session, "High");
    await server.wait();

    expect(await task4.getIndexDoc()).not.toEqual(oldTask4IndexDoc);

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            sorts,
            afterCursor,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });
});

test("expensively loading after an old cursor can return the moved task again", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);
    const sorts = normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]);
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Medium"),
        task3.updatePriority(session, "High"),
        task4.updatePriority(session, "Urgent"),
        task5.updatePriority(session, "Urgent"),
    ]);
    await server.wait();

    const firstPage = await server.loadQuery(session, {
        limit: 3,
        sorts,
    });
    const afterCursor = getTaskQueryNormalizedSortCursorForIndexDoc(
        sorts,
        assertExists(firstPage.tasks[2]),
    );

    expect(firstPage).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task3.updatePriority(session, "Low");
    await server.wait();

    expect(
        await server.expensivelyLoadQueryAfterCursor(session, {
            limit: 3,
            sorts,
            afterCursor,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});
