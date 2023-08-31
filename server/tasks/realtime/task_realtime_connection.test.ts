import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
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
import {taskRealtimeQueryStoreBeforeSendEventTestCheckpoint} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
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

function createWebSocketServer(space: TestSpace) {
    // Important that this is run before `TestTaskRealtimeServer`. We want to close
    // the WebSocket server before running our realtime server cleanup.
    afterTestEnds(() => webSocketServer.closeAll(context));

    const server = new TestTaskRealtimeServer(context);

    const webSocketServer = new WebSocketServer<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeConnection
    >(
        context,
        TaskRealtimeProtocol,
        ({accountId, sendEvent, closeWithError}) =>
            new TaskRealtimeConnection({
                server: server.server,
                spaceId: space.id,
                accountId,
                dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                sendEvent,
                closeWithError,
            }),
    );

    return Object.assign(webSocketServer, {
        wait: () => server.wait(),
        waitForApplyActionTransactions: () => server.waitForApplyActionTransactions(),
        waitForIndexActionTransactions: () => server.waitForIndexActionTransactions(),
        pauseApplyActionTransactions: () => server.pauseApplyActionTransactions(),
        unpauseApplyActionTransactions: () => server.unpauseApplyActionTransactions(),
        evictAll: () => server.evictAll(),
        applyActionTransaction: (options: {
            spaceId: SpaceId;
            committedTime: Date;
            actions: ReadonlyArray<TaskAction>;
        }) => server.applyActionTransaction(options),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task5.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task3.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task5.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task2.removeCollection(session1, collection2);
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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

    await task5.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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

test("collections can be referenced, unreferenced, then referenced again", async () => {
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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

    expect(connection1.takeEvents().sort((a, b) => a.number - b.number)).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
        {
            type: "Update",
            number: expect.any(Number),
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
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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

    expect(connection1.takeEvents().sort((a, b) => a.number - b.number)).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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
    ]);

    await task4.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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

    expect(connection.takeEvents().sort((a, b) => a.number - b.number)).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
        {
            type: "Update",
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
            number: expect.any(Number),
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
                number: expect.any(Number),
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
                number: expect.any(Number),
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

test("multiple subscriptions that receive the same actions only show action once in update event", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, collection1, collection2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.createPublic(session),
        TestTaskCollection.createPublic(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection2),
        task3.addCollection(session, collection1),
        task3.addCollection(session, collection2),
    ]);

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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
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

    expect(
        await connection.procedures.subscribeToQuery(
            query(session, {
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

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task2.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

test("referenced task may be unauthorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task1.updateParentTask(session1, parentTask1),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session2, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("unauthorized referenced task will be authorized if later loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task1.updateParentTask(session1, parentTask1),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session2, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await parentTask1.addCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.removeCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("authorized referenced task may be loaded later", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task1.updateParentTask(session1, parentTask1),
        parentTask1.addCollection(session1, collection2),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
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

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: parentTask1.id}),
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

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.addCollection(session1, collection1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
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

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.removeCollection(session1, collection1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([]);
});

test("a loaded task may then become referenced", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        parentTask1.addCollection(session1, collection),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session2, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await task1.updateParentTask(session1, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
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
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTask1.id,
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

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.removeCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);
});

test("loaded task may be loaded by two subscriptions", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task3.addCollection(session2, collection),
    ]);

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: task3.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session2.get()],
        },
    ]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task3.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task1.removeCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
    ]);

    await task3.removeCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task1.updatePriority(session1, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task3.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task1.updateAssignee(session1, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
    ]);

    await task1.updatePriority(session1, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task2.updatePriority(session1, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task3.updatePriority(session2, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("authorized referenced task may be referenced multiple times", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        parentTask1.addCollection(session2, collection),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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

    expect(connection.takeEvents()).toEqual([]);

    await task1.updateParentTask(session1, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task1.updateParentTask(session1, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("unauthorized referenced task may be referenced multiple times", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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

    expect(connection.takeEvents()).toEqual([]);

    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task1.updateParentTask(session1, null);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("may reference unauthorized collections", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection1, collection2, collection3] = await runAllPromises(
        [
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTaskCollection.createPublic(session2),
            TestTaskCollection.createPrivate(session2),
            TestTaskCollection.createPrivate(session2),
        ],
    );

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.updateParentTask(session1, parentTask1),
    ]);

    await parentTask1.addCollection(session1, collection1);
    await parentTask1.addCollection(session2, collection2);

    await task2.addCollection(session1, collection1);
    await task2.addCollection(session2, collection3);
    await task2.removeCollection(session1, collection1);

    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [collection3.id, collection2.id],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await collection1.updateName(session1, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await collection3.updateName(session2, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("authorized referenced collection may be referenced multiple times", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session2),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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

    expect(connection.takeEvents()).toEqual([]);

    await task1.addCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await collection.updateName(session1, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await task1.removeCollection(session1, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
    ]);

    await collection.updateName(session1, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("unauthorized referenced collection may be referenced multiple times", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPrivate(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection2),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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

    expect(connection.takeEvents()).toEqual([]);

    await task1.addCollection(session2, collection1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
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
            backfillUnauthorizedCollectionIds: [collection1.id],
            referencedAccounts: [],
        },
    ]);

    await collection1.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await task1.removeCollection(session2, collection1);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collection1.id,
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

    await collection1.updateName(session2, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("will reauthorize an unauthorized referenced task to authorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await parentTask1.addCollection(session2, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [expect.objectContaining({id: parentTask1.id})],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

test("will reauthorize an authorized referenced task to unauthorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await parentTask1.removeCollection(session2, collection);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTask1.id,
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

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("reauthorize will noop if an unauthorized referenced task is still unauthorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("reauthorize will noop if an authorized referenced task is still authorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

test("will reauthorize an unauthorized referenced collection to authorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPrivate(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [collection2.id],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await collection2.setPublicAccessPolicy(session2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection2.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session2, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
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

test("will reauthorize an authorized referenced collection to unauthorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
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

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await collection2.setPrivateAccessPolicy(session2);
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: expect.objectContaining({
                        type: "UpdateAccessPolicy",
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

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [collection2.id],
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session2, "Test 3");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("reauthorize will noop if an unauthorized referenced collection is still unauthorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPrivate(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [collection2.id],
            referencedAccounts: [await session1.get()],
        },
    ]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([]);
});

test("reauthorize will noop if an authorized referenced collection is still authorized", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(connection.takeEvents()).toEqual([]);

    expect(
        await connection.procedures.subscribeToQuery(
            query(session1, {
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
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

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await connection.authorize();

    expect(connection.takeEvents()).toEqual([]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(connection.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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
});

test("referenced data is not evicted", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, task2, task3, parentTask1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateParentTask(session1, parentTask1),
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task3.addCollection(session1, collection1),
        parentTask1.addCollection(session1, collection2),
    ]);
    await server.wait();

    const connection1 = await server.connectForTest(session1.action());

    expect(connection1.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(0);

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

    expect(getCount()).toEqual(1);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
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

    expect(getCount()).toEqual(1);

    server.evictAll();

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
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

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(connection2.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(1);

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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection2.id}),
                expect.objectContaining({id: collection1.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);
});

test("unreferenced data is evicted", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, task2, task3, parentTask1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateParentTask(session1, parentTask1),
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task3.addCollection(session1, collection1),
        parentTask1.addCollection(session1, collection2),
    ]);
    await server.wait();

    const connection1 = await server.connectForTest(session1.action());

    expect(connection1.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(0);

    const {querySubscriptionId, ...result} = await connection1.procedures.subscribeToQuery(
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
    );

    expect(result).toEqual({
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(1);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
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

    expect(getCount()).toEqual(1);

    await connection1.procedures.unsubscribeFromQuery({
        querySubscriptionId,
    });

    expect(getCount()).toEqual(1);

    server.evictAll();

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(connection2.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(1);

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

    expect(getCount()).toEqual(2);

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
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
});

test("unreferenced data can be reused when no eviction", async () => {
    const space = await TestSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const server = createWebSocketServer(space);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const [task1, task2, task3, parentTask1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.updateParentTask(session1, parentTask1),
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task3.addCollection(session1, collection1),
        parentTask1.addCollection(session1, collection2),
    ]);
    await server.wait();

    const connection1 = await server.connectForTest(session1.action());

    expect(connection1.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(0);

    const {querySubscriptionId, ...result} = await connection1.procedures.subscribeToQuery(
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
    );

    expect(result).toEqual({
        loadedState: {type: "Full"},
    });

    expect(getCount()).toEqual(1);

    expect(connection1.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
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

    expect(getCount()).toEqual(1);

    await connection1.procedures.unsubscribeFromQuery({
        querySubscriptionId,
    });

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(connection1.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(connection2.takeEvents()).toEqual([]);

    expect(getCount()).toEqual(1);

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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection2.id}),
                expect.objectContaining({id: collection1.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    ]);
});

test("can handle temporary cycle involving loaded tasks when actions are applied out-of-order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task3.updatePriority(session, "High");
    await task1.updateParentTask(session, task2);
    await task2.updateParentTask(session, task3);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    expect(
        await connection1.procedures.subscribeToQuery(
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
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();

    await expect(task3.updateParentTask(session, task1, {time: time2})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await task2.updateParentTask(session, null, {time: time1});
    await task3.updateParentTask(session, task1, {time: time2});
    await server.waitForIndexActionTransactions();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
    ];

    const actions2: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
    ];

    // Apply action transaction out of order temporarily creating a cycle...
    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions2,
    });

    const connection2 = await server.connectForTest(session.action());

    expect(connection2.takeEvents()).toEqual([]);

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
                    {
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: new Set(["High"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task1.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    const time3 = testClock.nowLogical();

    await task3.updatePriority(session, "Low", {time: time3});
    await server.waitForIndexActionTransactions();

    const actions3: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
    ];

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions3,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId: task3.id,
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

    const time4 = testClock.nowLogical();

    await task2.updatePriority(session, "High", {time: time4});
    await server.waitForIndexActionTransactions();

    const actions4: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time4,
            taskId: task2.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
    ];

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions4,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
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

    server.unpauseApplyActionTransactions();
    await server.wait();

    connection2.takeEvents();

    await task1.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([]);

    await task2.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateAssignee",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task3.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([]);
});

test("can handle temporary cycle not involving loaded tasks when actions are applied out-of-order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task5.updatePriority(session, "High");
    await task1.updateParentTask(session, task2);
    await task2.updateParentTask(session, task3);
    await task5.updateParentTask(session, task4);
    await task4.updateParentTask(session, task3);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    expect(
        await connection1.procedures.subscribeToQuery(
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

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();

    await expect(task3.updateParentTask(session, task1, {time: time2})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await task1.updateParentTask(session, null, {time: time1});
    await task3.updateParentTask(session, task1, {time: time2});
    await server.waitForIndexActionTransactions();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
    ];

    const actions2: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
    ];

    // Apply action transaction out of order temporarily creating a cycle...
    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions2,
    });

    const connection2 = await server.connectForTest(session.action());

    expect(connection2.takeEvents()).toEqual([]);

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
                    {
                        type: "Priority",
                        operation: {
                            type: "OneOf",
                            priorities: new Set(["High"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    const time3 = testClock.nowLogical();

    await task5.updatePriority(session, "Low", {time: time3});
    await server.waitForIndexActionTransactions();

    const actions3: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time3,
            taskId: task5.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
    ];

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions3,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: time3,
                    taskId: task5.id,
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

    const time4 = testClock.nowLogical();

    await task5.updatePriority(session, "High", {time: time4});
    await server.waitForIndexActionTransactions();

    const actions4: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time4,
            taskId: task5.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
    ];

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions4,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
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

    server.unpauseApplyActionTransactions();
    await server.wait();

    connection2.takeEvents();

    await task1.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateAssignee",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([]);

    await task3.updateAssignee(session, session);
    await server.wait();

    expect(connection2.takeEvents()).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateAssignee",
                    }),
                },
            ],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);
});

test("can handle temporary cycle not involving loaded tasks when actions are applied out-of-order and task loading is delayed (scenario 1)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task5.updatePriority(session, "High");
    await task2.updateParentTask(session, task3);
    await task5.updateParentTask(session, task4);
    await task4.updateParentTask(session, task3);
    await task2.updatePriority(session, "Medium");

    await server.wait();

    const connection1 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    //
    // However, we want to exclude `task2`!
    expect(
        await connection1.procedures.subscribeToQuery(
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
                            type: "NoneOf",
                            priorities: new Set(["Medium"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();
    const time3 = testClock.nowLogical();

    await task1.updateParentTask(session, task2, {time: time1});

    await expect(task3.updateParentTask(session, task1, {time: time3})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await task1.updateParentTask(session, null, {time: time2});
    await task3.updateParentTask(session, task1, {time: time3});
    await server.waitForIndexActionTransactions();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
    ];

    const actions2: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
    ];

    const actions3: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
    ];

    const pause1Promise = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const applyActions1Promise = server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    const {unpause: unpause1} = await pause1Promise;

    // Apply action transaction out of order temporarily creating a cycle...
    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions3,
    });

    const connection2 = await server.connectForTest(session.action());

    expect(connection2.takeEvents()).toEqual([]);

    const pause2Promise = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    const subscribePromise = connection2.procedures.subscribeToQuery(
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

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    expect(connection2.takeEvents()).toEqual([]);

    unpause1();
    await applyActions1Promise;
    await subscribePromise;

    expect(connection2.takeEvents().sort((a, b) => a.number - b.number)).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions2,
    });
});

test("can handle temporary cycle not involving loaded tasks when actions are applied out-of-order and task loading is delayed (scenario 2)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await task5.updatePriority(session, "High");
    await task2.updateParentTask(session, task3);
    await task5.updateParentTask(session, task4);
    await task4.updateParentTask(session, task3);
    await task2.updatePriority(session, "Medium");

    await server.wait();

    const connection1 = await server.connectForTest(session.action());

    expect(connection1.takeEvents()).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    //
    // However, we want to exclude `task2`!
    expect(
        await connection1.procedures.subscribeToQuery(
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
                            type: "NoneOf",
                            priorities: new Set(["Medium"]),
                        },
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
    });

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();
    const time3 = testClock.nowLogical();

    await task1.updateParentTask(session, task2, {time: time1});

    await expect(task3.updateParentTask(session, task1, {time: time3})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task's `parentTaskId` would create a circular dependency",
        ),
    );

    await task1.updateParentTask(session, null, {time: time2});
    await task3.updateParentTask(session, task1, {time: time3});
    await server.waitForIndexActionTransactions();

    const actions1: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task2.id,
            },
        },
    ];

    const actions2: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task1.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
    ];

    const actions3: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: task1.id,
            },
        },
    ];

    const pause1Promise = taskRealtimeQueryStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const applyActions1Promise = server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    const {unpause: unpause1} = await pause1Promise;

    // Apply action transaction out of order temporarily creating a cycle...
    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions3,
    });

    const connection2 = await server.connectForTest(session.action());

    expect(connection2.takeEvents()).toEqual([]);

    const pause2Promise = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    const subscribePromise = connection2.procedures.subscribeToQuery(
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

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    const time4 = testClock.nowLogical();

    await task5.updatePriority(session, "Low", {time: time4});
    await server.waitForIndexActionTransactions();

    const actions4: Array<TaskAction> = [
        {
            type: "UpdateTask",
            time: time4,
            taskId: task5.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
    ];

    const pause3Promise = taskRealtimeQueryStoreBeforeSendEventTestCheckpoint.pauseForTest(
        space.id,
    );

    const applyActions4Promise = server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions4,
    });

    const {unpause: unpause3} = await pause3Promise;
    unpause3();

    expect(connection2.takeEvents()).toEqual([]);

    unpause1();
    await applyActions1Promise;
    await subscribePromise;
    await applyActions4Promise;

    expect(connection2.takeEvents().sort((a, b) => a.number - b.number)).toEqual([
        {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task2.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
        {
            type: "Update",
            number: expect.any(Number),
            actions: [
                {
                    type: "UpdateTask",
                    time: time4,
                    taskId: task5.id,
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

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions2,
    });
});
