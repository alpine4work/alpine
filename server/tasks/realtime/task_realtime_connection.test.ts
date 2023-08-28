import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {queryTaskIndexTestCounter} from "~/server/tasks/data/task_index.js";
import {TaskRealtimeConnection} from "~/server/tasks/realtime/task_realtime_connection.js";
import {
    taskRealtimeQueryStoreBeforeLoadCollectionTestCheckpoint,
    taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint,
} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {taskRealtimeQueryStoreBeforeSendEventTestCheckpoint} from "~/server/tasks/realtime/task_realtime_update_event.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

const context = createTestContext({shouldStartOpensearch: true});

let afterEachCleanupCallbacks: Array<() => MaybePromise<void>> = [];

afterEach(async () => {
    const callbacks = afterEachCleanupCallbacks;
    afterEachCleanupCallbacks = [];

    await runAllPromises(callbacks.map(callback => callback()));
});

function createWebSocketServer(space: TestSpace) {
    const server = new TestTaskRealtimeServer(context);

    const webSocketServer = new WebSocketServer<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeConnection
    >(
        context,
        TaskRealtimeProtocol,
        ({accountId, sendEvent}) =>
            new TaskRealtimeConnection({
                server: server.server,
                spaceId: space.id,
                accountId,
                dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                sendEvent,
            }),
    );

    afterEachCleanupCallbacks.push(() => webSocketServer.closeAll(context));

    return Object.assign(webSocketServer, {
        wait: () => server.wait(),
        waitForApplyActionTransactions: () => server.waitForApplyActionTransactions(),
    });
}

function query(
    session: TestSpaceSession,
    options?: {
        filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
        limit?: number;
    },
): {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    limit: number;
} {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: session.account.id,
        currentDate: toCalendarDate(
            parseAbsolute(testClock.nowDate().toISOString(), defaultTimeZone),
        ),
    };

    const filters = options?.filters
        ? isReadonlyArray(options.filters)
            ? normalizeTaskQueryFilters(options.filters, evaluationContext)
            : ({type: "Possible", normalizedFilters: options.filters} as const)
        : normalizeTaskQueryFilters([], evaluationContext);

    assert(filters.type !== "Impossible");

    return {
        filters: filters.normalizedFilters,
        sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
        limit: options?.limit ?? 100,
    };
}

test("can't load a query with no filters", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    await expect(connection.procedures.subscribeToQuery(query(session))).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    expect(connection.takeEvents()).toEqual([]);
});

test("can load a query when there are no tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([]);
});

test("can load a query with some tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("can paginate a query with many tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
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

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 3,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    );
    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task6.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task6.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task7.id}),
                expect.objectContaining({id: task8.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("can load a query with filters", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Low");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Low");

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                    {
                        type: "Priority",
                        operation: {type: "OneOf", priorities: new Set(["Low"])},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                    {
                        type: "Priority",
                        operation: {type: "OneOf", priorities: new Set(["Medium"])},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("can load a query with sorts", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Low");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Low");

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("two subscriptions with identical queries use the same underlying query", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
    ]);

    const collection = await TestTaskCollection.createPublic(session1);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task3.addCollection(session1, collection),
        task4.addCollection(session1, collection),
        task5.addCollection(session1, collection),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(context.action(session1));
    const connection2 = await server.connectForTest(context.action(session2));

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session2, {
                filters: [
                    {
                        type: "Collections",
                        operation: {type: "IncludesOneOf", collectionIds: new Set([collection.id])},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(1);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(getCount()).toEqual(1);

    const {querySubscriptionId, ...result} = await connection1.procedures.subscribeToQuery(
        query(session1, {
            limit: 3,
            filters: [
                {
                    type: "Collections",
                    operation: {type: "IncludesOneOf", collectionIds: new Set([collection.id])},
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(getCount()).toEqual(1);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(getCount()).toEqual(1);

    expect(
        await connection1.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(1);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(getCount()).toEqual(1);
});

test("two subscriptions with different queries load different queries", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
    ]);

    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection2),
        task3.addCollection(session1, collection1),
        task4.addCollection(session1, collection2),
        task5.addCollection(session1, collection1),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(context.action(session1));
    const connection2 = await server.connectForTest(context.action(session2));

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session2, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(1);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(getCount()).toEqual(1);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(2);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(getCount()).toEqual(2);
});

test("will send actions for updated tasks in the subscription's loaded range", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, , task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("will send actions for removed tasks in the subscription's loaded range", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, , task3, , task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("will backfill added tasks in the subscription's loaded range", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, , task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.addCollection(session, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("will send actions for updated tasks in multiple connections", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
    ]);

    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task3.addCollection(session1, collection1),
        task4.addCollection(session1, collection1),

        task2.addCollection(session1, collection2),
        task3.addCollection(session1, collection2),
        task4.addCollection(session1, collection2),
        task5.addCollection(session1, collection2),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(context.action(session1));
    const connection2 = await server.connectForTest(context.action(session2));
    const connection3 = await server.connectForTest(context.action(session3));
    const connection4 = await server.connectForTest(context.action(session1));

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
    expect(connection3.takeEvents()).toEqual([]);
    expect(connection4.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection4.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection4.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task3.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task5.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("will send actions for removed/added tasks in multiple connections", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
    ]);

    const collection1 = await TestTaskCollection.createPublic(session1);
    const collection2 = await TestTaskCollection.createPublic(session1);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task3.addCollection(session1, collection1),
        task4.addCollection(session1, collection1),

        task2.addCollection(session1, collection2),
        task3.addCollection(session1, collection2),
        task4.addCollection(session1, collection2),
        task5.addCollection(session1, collection2),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(context.action(session1));
    const connection2 = await server.connectForTest(context.action(session2));
    const connection3 = await server.connectForTest(context.action(session3));
    const connection4 = await server.connectForTest(context.action(session1));

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);
    expect(connection3.takeEvents()).toEqual([]);
    expect(connection4.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection4.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(
        await connection4.procedures.subscribeToQuery(
            query(session1, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection2.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task2.removeCollection(session1, collection2);
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task5.addCollection(session1, collection1);
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task5.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: task5.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task5.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection4.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task5.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("visible task added out of loaded range ignored", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                limit: 3,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                limit: 0,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.addCollection(session, collection);
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task4.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("visible task updated out of loaded range ignored", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task4.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                limit: 3,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                limit: 0,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.updatePriority(session, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task4.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("visible task removed out of loaded range ignored", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task4.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                limit: 3,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                limit: 0,
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.removeCollection(session, collection);
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task4.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("visible task moved into loaded range", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task4.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "High");
    await task5.updatePriority(session, "High");

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                limit: 3,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [2, expect.any(Array), task3.id]},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                limit: 0,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.updatePriority(session, "Low");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task4.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task4.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("visible task moved out of loaded range", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.createPublic(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task4.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Low");
    await task4.updatePriority(session, "Low");
    await task5.updatePriority(session, "Medium");

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                limit: 3,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [1, expect.any(Array), task3.id]},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                limit: 0,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(
        await connection3.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Priority", direction: "Ascending"}],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([]);

    expect(connection3.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("unsubscribe stops sending actions to connection", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    const {querySubscriptionId, ...result} = await connection1.procedures.subscribeToQuery(
        query(session, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Full"},
    });

    expect(
        await connection2.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Low");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    expect(await connection1.procedures.unsubscribeFromQuery({querySubscriptionId})).toEqual({});

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("loading tasks with zero limit is fine", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 0,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 0,
        }),
    ).toEqual({
        loadedState: {type: "Partial", endCursor: null},
    });

    expect(connection.takeEvents()).toEqual([]);
});

test("loading tasks with zero limit when there are no tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    await server.wait();

    const connection = await server.connectForTest(session.action());

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 0,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 0,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([]);
});

test("all referenced collections will be backfilled in the query when loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        task4,
        task5,
        collection1a,
        collection1b,
        collection2a,
        collection2b,
        collection3a,
        collection3b,
        collection4a,
        collection4b,
        collection5a,
        collection5b,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1a),
        task1.addCollection(session, collection1b),
        task2.addCollection(session, collection2a),
        task2.addCollection(session, collection2b),
        task3.addCollection(session, collection3a),
        task3.addCollection(session, collection3b),
        task4.addCollection(session, collection4a),
        task4.addCollection(session, collection4b),
        task5.addCollection(session, collection5a),
        task5.addCollection(session, collection5b),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 3,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1a.id}),
                expect.objectContaining({id: collection1b.id}),
                expect.objectContaining({id: collection2a.id}),
                expect.objectContaining({id: collection2b.id}),
                expect.objectContaining({id: collection3a.id}),
                expect.objectContaining({id: collection3b.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection4a.id}),
                expect.objectContaining({id: collection4b.id}),
                expect.objectContaining({id: collection5a.id}),
                expect.objectContaining({id: collection5b.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("all referenced collections will be backfilled in the query when added", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        task4,
        collection1a,
        collection1b,
        collection2a,
        collection2b,
        collection3a,
        collection3b,
        collection4a,
        collection4b,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task4.updatePriority(session, "Low"),
        task1.addCollection(session, collection1a),
        task1.addCollection(session, collection1b),
        task2.addCollection(session, collection2a),
        task2.addCollection(session, collection2b),
        task3.addCollection(session, collection3a),
        task3.addCollection(session, collection3b),
        task4.addCollection(session, collection4a),
        task4.addCollection(session, collection4b),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: new Set(["Low"]),
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1a.id}),
                expect.objectContaining({id: collection1b.id}),
                expect.objectContaining({id: collection2a.id}),
                expect.objectContaining({id: collection2b.id}),
                expect.objectContaining({id: collection4a.id}),
                expect.objectContaining({id: collection4b.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task3.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task3.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection3a.id}),
                expect.objectContaining({id: collection3b.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("when a collection is added it will be backfilled", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        task4,
        collection1a,
        collection1b,
        collection2a,
        collection2b,
        collection3a,
        collection3b,
        collection4a,
        collection4b,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1a),
        task1.addCollection(session, collection1b),
        task2.addCollection(session, collection2a),
        task2.addCollection(session, collection2b),
        task3.addCollection(session, collection3a),
        task4.addCollection(session, collection4a),
        task4.addCollection(session, collection4b),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1a.id}),
                expect.objectContaining({id: collection1b.id}),
                expect.objectContaining({id: collection2a.id}),
                expect.objectContaining({id: collection2b.id}),
                expect.objectContaining({id: collection3a.id}),
                expect.objectContaining({id: collection4a.id}),
                expect.objectContaining({id: collection4b.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task3.addCollection(session, collection3b);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3b.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection3b.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection3a);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection3a.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("if a collection is referenced then the connection will receive actions for the collection", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection1, collection2, collection3] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task3.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection3.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection1.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task1.addCollection(session, collection2);
    await task1.removeCollection(session, collection1);
    await server.wait();

    connection.takeEvents();

    await collection1.updateName(session, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await collection2.updateName(session, "Test 4");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 4",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("if a collection is referenced then the all references must be removed to no longer receive actions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session, collection);
    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 2",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task3.addCollection(session, collection);
    await task2.removeCollection(session, collection);
    await collection.updateName(session, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 3",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection);
    await collection.updateName(session, "Test 4");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("collections unreferenced by removing loaded task do not receive actions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Low"),
        task1.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                    {
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: new Set(["Low"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("collections can be referenced, unreferenced, then unreferenced again", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Low"),
        task1.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                    {
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: new Set(["Low"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task1.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection.updateName(session, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 3",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("parent tasks are backfilled when query is initially loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask2),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("parent tasks are backfilled when more is loaded from query", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, parentTask1, parentTask2, parentTask5, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task4.addCollection(session, collection),
        task5.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask2),
        task5.updateParentTask(session, parentTask5),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 3,
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
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: parentTask5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("parent tasks are backfilled when task is made visible", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.addCollection(session, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("parent tasks is backfilled when task is updated", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("parents of loaded tasks receive update actions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("parents of loaded tasks receive update actions until all references are removed", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "Urgent");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Urgent",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("grandparent tasks are backfilled when query is initially loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("grandparent tasks are backfilled when more is loaded from query", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task4.addCollection(session, collection),
        task5.addCollection(session, collection),
        task4.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 3,
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
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("grandparent tasks are backfilled when task is made visible", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.addCollection(session, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("grandparent tasks are backfilled when task is updated", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, null);
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user dedents:
    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user indents:
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("grandparents of loaded tasks receive update actions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("grandparents of loaded tasks receive update actions until all references are removed", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, collection] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask2),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask3.updatePriority(session, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Low",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask3.id}),
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "Urgent");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Urgent",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("collections of parent tasks are backfilled when query is initially loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        parentTask1,
        parentTask2,
        parentTask3,
        collection1,
        collection2,
        collection3,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        task3.updateParentTask(session, parentTask3),
        parentTask2.addCollection(session, collection2),
        parentTask3.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection3.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("collections of parent tasks are backfilled when more is loaded from query", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [
        task1,
        task2,
        task3,
        task4,
        task5,
        parentTask1,
        parentTask2,
        parentTask3,
        collection1,
        collection2,
        collection3,
    ] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        task4.addCollection(session, collection1),
        task5.addCollection(session, collection1),
        task4.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        task5.updateParentTask(session, parentTask3),
        parentTask2.addCollection(session, collection2),
        parentTask3.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    const {querySubscriptionId, ...result} = await connection.procedures.subscribeToQuery(
        query(session, {
            limit: 3,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id]),
                    },
                },
            ],
        }),
    );

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(
        await connection.procedures.loadMoreQueryTasks({
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection3.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("collections of parent tasks are backfilled when task is made visible", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection1, collection2] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.addCollection(session, collection2),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.addCollection(session, collection1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("collections of parent tasks are backfilled when task is updated", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection1, collection2] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.addCollection(session, collection2),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, null);
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user dedents:
    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user indents:
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("collections of parents of loaded tasks receive update actions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection1, collection2, collection3] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        task1.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask1.addCollection(session, collection2),
        parentTask2.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
                expect.objectContaining({id: collection3.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection3.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 2",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection3.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection3.updateName(session, "Test 4");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 4",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 5");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("collections of parents of loaded tasks receive update actions until all references are removed", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, parentTask1, parentTask2, collection1, collection2] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.createPublic(session),
            TestTaskCollection.createPublic(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection1),
        task3.addCollection(session, collection1),
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask2),
        parentTask1.updateParentTask(session, parentTask2),
        parentTask2.addCollection(session, collection2),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection1.id}),
                expect.objectContaining({id: collection2.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection2.updateName(session, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 1",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 2",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: parentTask2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection2.updateName(session, "Test 4");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test 4",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("race condition: parent task can change before previous parent task has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updateAssignee(session, session);
    await task3.updatePriority(session, "High");
    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Make sure `task3` is loaded in the store...
    await connection2.procedures.subscribeToQuery(
        query(session, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: new Set(["High"]),
                    },
                },
            ],
        }),
    );

    // Pause loading of `task2`...
    const pausePromise1 = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `task2`.
    (await pausePromise2).unpause();

    expect(connection1.takeEvents()).toEqual([]);

    const pausePromise3 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Update to `task3` before `task2` has loaded.
    await task1.updateParentTask(session, task3);

    expect(connection1.takeEvents()).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause3} = await pausePromise3;

    expect(connection1.takeEvents()).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    // Events are sent out-of-order but it's ok since the client can use `time` to
    // figure out `task3` is the correct parent task.
    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: task3.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: task3.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: task2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: task2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("race condition: parent task can change before previous grandparent task has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await runAllPromises([
        task1.updateAssignee(session, session),
        task2.updatePriority(session, "High"),
        task3.updatePriority(session, "High"),
        task2.updateParentTask(session, task4),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Pause loading of `task4`...
    const pausePromise1 = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Make sure `task2` and `task3` are loaded in the store...
    void connection2.procedures.subscribeToQuery(
        query(session, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: new Set(["High"]),
                    },
                },
            ],
        }),
    );

    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `task4`.
    (await pausePromise2).unpause();

    const pausePromise3 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );
    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` which is blocked on loading `task4`.
    (await pausePromise3).unpause();

    expect(connection1.takeEvents()).toEqual([]);

    const pausePromise4 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Update to `task3` before `task4` has loaded.
    await task1.updateParentTask(session, task3);

    expect(connection1.takeEvents()).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause4} = await pausePromise4;

    expect(connection1.takeEvents()).toEqual([]);

    unpause1();
    unpause4();

    await waitPromise1;
    await waitPromise2;

    const compare = ({actions: actions1}: any, {actions: actions2}: any) =>
        defaultCompareStrings(
            actions1[0].taskAction.parentTaskId,
            actions2[0].taskAction.parentTaskId,
        );

    expect(connection1.takeEvents().sort(compare)).toEqual(
        [
            {
                type: "Update",
                actions: [
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: task2.id,
                        },
                    },
                ],
                backfillAuthorizedTasks: [
                    expect.objectContaining({id: task2.id}),
                    expect.objectContaining({id: task4.id}),
                ],
                backfillUnauthorizedTaskIds: [],
                backfillAuthorizedCollections: [],
                backfillUnauthorizedCollectionIds: [],
                referencedAccounts: [await session.get()],
            },
            {
                type: "Update",
                actions: [
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: task3.id,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task2.id,
                        taskAction: expect.objectContaining({
                            type: "UpdateChildrenCounts",
                        }),
                    },
                ],
                backfillAuthorizedTasks: [expect.objectContaining({id: task3.id})],
                backfillUnauthorizedTaskIds: [],
                backfillAuthorizedCollections: [],
                backfillUnauthorizedCollectionIds: [],
                referencedAccounts: [await session.get()],
            },
        ].sort(compare),
    );

    await task4.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("race condition: parent task is removed before it's loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task1.updateAssignee(session, session);
    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Pause loading of `task2`...
    const pausePromise1 = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `task2`.
    (await pausePromise2).unpause();

    expect(connection.takeEvents()).toEqual([]);

    const pausePromise3 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Remove `task1` from loaded tasks.
    await task1.updateAssignee(session, null);

    expect(connection.takeEvents()).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause3} = await pausePromise3;

    expect(connection.takeEvents()).toEqual([]);

    await task2.updatePriority(session, "High");

    expect(connection.takeEvents()).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    // Events are sent out-of-order but it's ok since the client can use `time` to
    // figure out `task3` is the correct parent task.
    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: null,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: task2.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: task2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("race condition: collection can be removed before previous collection has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, collection] = await runAllPromises([
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await task1.updateAssignee(session, session);
    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Pause loading of `collection`...
    const pausePromise1 = taskRealtimeQueryStoreBeforeLoadCollectionTestCheckpoint.pauseForTest(
        space.id,
    );

    const pausePromise2 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    await task1.addCollection(session, collection);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `collection`.
    (await pausePromise2).unpause();

    expect(connection1.takeEvents()).toEqual([]);

    const pausePromise3 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Remove `collection` fore `collection` has loaded.
    await task1.removeCollection(session, collection);

    expect(connection1.takeEvents()).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `collection` remove. But it's
    // also blocked on loading `collection`.
    const {unpause: unpause3} = await pausePromise3;

    expect(connection1.takeEvents()).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection.id,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
        {
            type: "Update",
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);
});

test("race condition: parent task can change before previous collection of parent task has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.updateAssignee(session, session),
        task2.updatePriority(session, "High"),
        task2.addCollection(session, collection),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);
    expect(connection2.takeEvents()).toEqual([]);

    expect(
        await connection1.procedures.subscribeToQuery(
            query(session, {
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    // Pause loading of `collection`...
    const pausePromise1 = taskRealtimeQueryStoreBeforeLoadCollectionTestCheckpoint.pauseForTest(
        space.id,
    );

    const pausePromise2 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Make sure `task2` is loaded in the store...
    void connection2.procedures.subscribeToQuery(
        query(session, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Priority",
                    operation: {
                        type: "OneOf",
                        priorities: new Set(["High"]),
                    },
                },
            ],
        }),
    );

    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `collection`.
    (await pausePromise2).unpause();

    const pausePromise3 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );
    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` which is blocked on loading `collection`.
    (await pausePromise3).unpause();

    expect(connection1.takeEvents()).toEqual([]);

    const pausePromise4 = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    // Remove parent before `collection` has loaded.
    await task1.updateParentTask(session, null);

    expect(connection1.takeEvents()).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our update. But it's also
    // blocked on loading `collection`.
    const {unpause: unpause4} = await pausePromise4;

    expect(connection1.takeEvents()).toEqual([]);

    unpause1();
    unpause4();

    await waitPromise1;
    await waitPromise2;

    const compare = ({actions: actions1}: any, {actions: actions2}: any) =>
        defaultCompareStrings(
            actions1[0].taskAction.parentTaskId ?? "null",
            actions2[0].taskAction.parentTaskId ?? "null",
        );

    expect(connection1.takeEvents().sort(compare)).toEqual(
        [
            {
                type: "Update",
                actions: [
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: task2.id,
                        },
                    },
                ],
                backfillAuthorizedTasks: [expect.objectContaining({id: task2.id})],
                backfillUnauthorizedTaskIds: [],
                backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
                backfillUnauthorizedCollectionIds: [],
                referencedAccounts: [await session.get()],
            },
            {
                type: "Update",
                actions: [
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task1.id,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: null,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: expect.any(Array),
                        taskId: task2.id,
                        taskAction: expect.objectContaining({
                            type: "UpdateChildrenCounts",
                        }),
                    },
                ],
                backfillAuthorizedTasks: [],
                backfillUnauthorizedTaskIds: [],
                backfillAuthorizedCollections: [],
                backfillUnauthorizedCollectionIds: [],
                referencedAccounts: [],
            },
        ].sort(compare),
    );

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);
});
