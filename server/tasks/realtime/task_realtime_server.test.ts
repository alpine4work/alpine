import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionTestCheckpoint,
    queryTaskIndex,
    queryTaskIndexTestCounter,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {backfillTaskActionTransactionHistoryTestCounter} from "~/server/tasks/data/task_table.js";
import {taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {
    TestTaskRealtimeServer,
    waitForIndexActionTransactionsWithoutClearingActionHistory,
} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {
    TaskQueryNormalizedFilters,
    defaultTaskQueryNormalizedFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    defaultTaskQueryNormalizedSorts,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";

const context = createTestContext({shouldStartOpensearch: true});

function testQueryTaskIndex(
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
    return queryTaskIndex(space.systemAction(), {
        spaceId: space.id,
        filters,
        sorts,
        limit,
        afterCursor: afterCursor
            ? getTaskQueryNormalizedSortCursorFromIndexDoc(sorts, afterCursor)
            : null,
    });
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

test("can't load a query as the wrong space", async () => {
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

test("can't apply an action transaction as the wrong space", async () => {
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
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await server.server.applyActionTransaction(space.systemAction(), {
        spaceId: session.space.id,
        committedTime: new Date(),
        actions: [],
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

test("won't load with a non-integer limit", async () => {
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

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

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

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

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

test("load can't introduce new task data which moves task outside of loaded range", async () => {
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

test("load can't introduce new task data which keeps task inside loaded range", async () => {
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

test("load can't introduce new task data which removes task from query", async () => {
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

test("load can't introduce new task data which adds updated task to query", async () => {
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

test("load can't introduce new task data which adds fresh task to query", async () => {
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

test("load gets task that's ahead of actions when it's fresh", async () => {
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

test("load gets old task at old position that's ahead of actions when already loaded", async () => {
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

test("load gets old task at old position that's ahead of actions when already loaded and clearing action history", async () => {
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

test("load doesn't put loaded task in already loaded range", async () => {
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

    const pausePromise = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

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

// This test is flaky due to a bug in OpenSearch:
// https://github.com/opensearch-project/OpenSearch/issues/9537
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

test("after loading tasks we will replay actions but won't add false positive missing tasks", async () => {
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

test("after loading tasks we will replay actions but won't add false positive missing tasks that were already loaded", async () => {
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

    const pausePromise = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

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

    const pausePromise = indexTaskActionTransactionTestCheckpoint.pauseForTest(space.id);
    const updatedTime = testClock.nowLogical();
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
                omitObject(assertExists(task), ["version"]),
            ),
        ]),
    );

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id).then(task =>
            omitObject(assertExists(task), ["version"]),
        ),
    ).not.toEqual(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
            .then(task => omitObject(assertExists(task), ["version"]))
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
                omitObject(assertExists(task), ["version"]),
            ),
            getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
                .then(task => omitObject(assertExists(task), ["version"]))
                .then(task => ({
                    ...task,
                    priority: task.priority.apply({value: "High", version: updatedTime}),
                })),
            getTaskIndexDocIfExistsForTest(context, space.id, task3.id).then(task =>
                omitObject(assertExists(task), ["version"]),
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

    const updatedTime = testClock.nowLogical();
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

    const updatedTime = testClock.nowLogical();
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

    const updatedTime = testClock.nowLogical();
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

    const updatedTime = testClock.nowLogical();
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

    const updatedTime = testClock.nowLogical();
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
