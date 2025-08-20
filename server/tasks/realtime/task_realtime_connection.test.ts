import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {queryTaskIndexTestCounter} from "~/server/tasks/data/task_index.js";
import {
    TaskRealtimeProcessContextModules,
    TaskRealtimeSessionActionContextModules,
} from "~/server/tasks/data/task_realtime_context.js";
import {
    commitTaskActionTransaction,
    deleteTaskAndAllChildren,
    updateTaskGridViewExpansionState,
} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {
    TaskRealtimeConnection,
    taskRealtimeConnectionAfterSubscribeToQueryTestCheckpoint,
} from "~/server/tasks/realtime/task_realtime_connection.js";
import {
    taskRealtimeStoreBeforeLoadCollectionTestCheckpoint,
    taskRealtimeStoreBeforeLoadTaskTestCheckpoint,
} from "~/server/tasks/realtime/task_realtime_store.js";
import {taskRealtimeStoreBeforeSendEventTestCheckpoint} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {
    WebSocketServer,
    WebSocketServerTestConnection,
} from "~/server/web_socket/web_socket_server.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
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
    defaultTaskQueryNormalizedSorts,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {
    TaskRealtimeEvent,
    TaskRealtimeProtocol,
    TaskRealtimeUpdateEvent,
} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TaskTitleModel, emptyTaskTitle} from "~/shared/tasks/title/task_title.js";
import {testClock} from "~/shared/test_helpers/test_clock.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";

const context = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

function createWebSocketServer(space: TestSpace) {
    // Important that this is run before `TestTaskRealtimeServer`. We want to close
    // the WebSocket server before running our realtime server cleanup.
    afterTestEnds(() => webSocketServer.closeAll(context));

    const server = new TestTaskRealtimeServer(context);

    const webSocketServer = new WebSocketServer<
        TaskRealtimeProcessContextModules,
        TaskRealtimeSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >(
        context,
        TaskRealtimeProtocol,
        ({accountId, sendEvent, closeWithError, resetAuthorizationTimer}) =>
            new TaskRealtimeConnection({
                server: server.server,
                spaceId: space.id,
                accountId,
                dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
                sendEvent,
                closeWithError,
                resetAuthorizationTimer,
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

async function createPublicTestTaskCollection(session: TestSpaceSession) {
    const collection = await TestTaskCollection.create(session, {
        access: {
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    return collection;
}

function query(
    session: TestSpaceSession,
    options?: {
        filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
        limit?: number;
    },
): {
    clientTime: HybridLogicalTime;
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
        clientTime: testClock.nowLogical(),
        filters: filters.normalizedFilters,
        sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
        limit: options?.limit ?? 100,
    };
}

async function testSubscribe(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
    input: WebSocketProtocolProceduresType<typeof TaskRealtimeProtocol>["subscribe"]["input"],
) {
    const result = await connection.procedures.subscribe(input);

    return {
        ...result,
        updateEvent: result.updateEvent ? massageUpdateEvent(result.updateEvent) : null,
    };
}

async function testSubscribeToQuery(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
    input:
        | WebSocketProtocolProceduresType<typeof TaskRealtimeProtocol>["subscribeToQuery"]["input"]
        | {
              session: TestSpaceSession;
              filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
              sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
              limit?: number;
          },
) {
    if ("session" in input) {
        input = query(input.session, input);
    }

    const result = await connection.procedures.subscribeToQuery(input);

    return {
        ...result,
        updateEvent: result.updateEvent ? massageUpdateEvent(result.updateEvent) : null,
    };
}

async function testSubscribeToTask(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
    input: WebSocketProtocolProceduresType<typeof TaskRealtimeProtocol>["subscribeToTask"]["input"],
) {
    const result = await connection.procedures.subscribeToTask(input);

    return {
        ...result,
        updateEvent: result.updateEvent ? massageUpdateEvent(result.updateEvent) : null,
    };
}

async function testSubscribeToCollection(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
    input: WebSocketProtocolProceduresType<
        typeof TaskRealtimeProtocol
    >["subscribeToCollection"]["input"],
) {
    const result = await connection.procedures.subscribeToCollection(input);

    return {
        ...result,
        updateEvent: result.updateEvent ? massageUpdateEvent(result.updateEvent) : null,
    };
}

async function testLoadMoreQueryTasks(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
    input:
        | WebSocketProtocolProceduresType<
              typeof TaskRealtimeProtocol
          >["loadMoreQueryTasks"]["input"],
) {
    const result = await connection.procedures.loadMoreQueryTasks(input);

    return {
        ...result,
        updateEvent: result.updateEvent ? massageUpdateEvent(result.updateEvent) : null,
    };
}

function testTakeEvents(
    connection: WebSocketServerTestConnection<
        ServerProcessContextModules,
        ServerSessionActionContextModules & {fork: ForkActionContextModule},
        typeof TaskRealtimeProtocol,
        TaskRealtimeEvent,
        TaskRealtimeConnection
    >,
) {
    return connection.takeEvents().map(event => {
        if (event.type !== "Update") return event;
        return massageUpdateEvent(event);
    });
}

function massageUpdateEvent(updateEvent: TaskRealtimeUpdateEvent) {
    return {
        ...updateEvent,
        // `backfillTasks` and `backfillCollections` may be returned in a
        // non-deterministic order. So to prevent flaky test failures we turn them into
        // an object where order doesn't matter to Jest when determining equality.
        backfillTasks: Object.fromEntries(
            updateEvent.backfillTasks.map((task): [TaskId, unknown] => {
                if (task.type !== "Authorized") return [task.taskId, task];

                return [task.task.id, task];
            }),
        ),
        backfillCollections: Object.fromEntries(
            updateEvent.backfillCollections.map((collection): [TaskCollectionId, unknown] => {
                if (collection.type !== "Authorized") return [collection.collectionId, collection];

                return [collection.collection.id, collection];
            }),
        ),
    };
}

function expectAuthorizedTask(collectionIds: Array<TaskCollectionId> = []) {
    return expect.objectContaining({
        type: "Authorized",
        task: expect.objectContaining({
            rawData: expect.objectContaining({
                collections: expect.objectContaining({
                    _array: collectionIds.map(collectionId =>
                        expect.objectContaining({collectionId}),
                    ),
                }),
            }),
        }),
    });
}

function expectUnauthorizedTask() {
    return expect.objectContaining({type: "Unauthorized"});
}

function expectAuthorizedCollection() {
    return expect.objectContaining({type: "Authorized"});
}

function expectUnauthorizedCollection() {
    return expect.objectContaining({type: "Unauthorized"});
}

test("can’t load a query with no filters", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    await expect(testSubscribeToQuery(connection, query(session))).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );

    expect(testTakeEvents(connection)).toEqual([]);
});

test("can load a query when there are no tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        }),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
        limit: 3,
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
        ],
    });
    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task6.id]},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask(),
                [task5.id]: expectAuthorizedTask(),
                [task6.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task7.id]: expectAuthorizedTask(), [task8.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task5.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task2.id]: expectAuthorizedTask(), [task4.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task5.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(
        await testSubscribeToQuery(connection2, {
            session: session2,
            filters: [
                {
                    type: "Collections",
                    operation: {type: "IncludesOneOf", collectionIds: new Set([collection.id])},
                },
            ],
        }),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(1);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(
        connection1,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    expect(
        await testLoadMoreQueryTasks(connection1, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection1)).toEqual([]);

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

    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);
    await collection2.access.grantDefault(session1);

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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(
        await testSubscribeToQuery(connection2, {
            session: session2,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [task5.id]: expectAuthorizedTask([collection1.id]),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(1);

    expect(
        await testSubscribeToQuery(connection1, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection2.id]),
                [task4.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(2);

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(2);
});

test("will send actions for updated tasks in the subscription’s loaded range", async () => {
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("will send actions for removed tasks in the subscription’s loaded range", async () => {
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("will backfill added tasks in the subscription’s loaded range", async () => {
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    await runAllPromises([
        task1.addCollection(session, collection),
        task3.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.addCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task2.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);
    await collection2.access.grantDefault(session1);

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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);
    expect(testTakeEvents(connection4)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task5.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(
            connection3,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task5.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection4, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection4, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [task2.id, task3.id, task4.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task5.id]: expectAuthorizedTask([collection2.id])},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);
    expect(testTakeEvents(connection4)).toEqual([]);

    await task3.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task5.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    const collection2 = await TestTaskCollection.create(session1);
    await collection2.access.grantDefault(session1);

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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);
    expect(testTakeEvents(connection4)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task5.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(
            connection3,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task5.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection4, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task4.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection4, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [task2.id, task3.id, task4.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task5.id]: expectAuthorizedTask([collection2.id])},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);
    expect(testTakeEvents(connection4)).toEqual([]);

    await task2.removeCollection(session1, collection2);
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task5.addCollection(session1, collection1);
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task5.id]: expectAuthorizedTask([collection2.id, collection1.id])},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task5.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection4)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("can update a referenced task in one query and remove the same referenced task in another query in the same connection", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [creatorSession, session1, session2] = await space.createSessions(3);

    const publicCollection = await TestTaskCollection.create(creatorSession);
    await publicCollection.access.grantDefault(creatorSession);

    const collection2 = await TestTaskCollection.create(creatorSession);
    await collection2.access.grantDefault(creatorSession);

    const collection3 = await TestTaskCollection.create(creatorSession);
    await collection3.access.grantDefault(creatorSession);

    const task1 = await TestTask.create(creatorSession);

    const task2 = await TestTask.create(creatorSession);
    await task2.updateParentTask(creatorSession, task1);

    const task3 = await TestTask.create(creatorSession);
    await task3.updateParentTask(creatorSession, task1);

    await task1.addCollection(creatorSession, publicCollection);
    await task2.addCollection(creatorSession, publicCollection);
    await task3.addCollection(creatorSession, publicCollection);

    await task2.addCollection(creatorSession, collection2);
    await task3.addCollection(creatorSession, collection3);

    await server.wait();

    const connection1 = await server.connectForTest(session1.action());
    const connection2 = await server.connectForTest(session2.action());

    // In this test, I'm exercising updating a referenced task in a query and
    // removing a referenced task in a different query in the same transaction.
    // `connection1` subscribes to the query that'll update the task first and
    // `connection2` subscribes to the query that'll remove the task first so we
    // can test both execution orders.
    {
        expect(
            await testSubscribeToQuery(
                connection1,
                query(session1, {
                    limit: 10,
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
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task2.id]: expectAuthorizedTask([publicCollection.id, collection2.id]),
                    [task1.id]: expectAuthorizedTask([publicCollection.id]),
                },
                backfillCollections: {
                    [publicCollection.id]: expectAuthorizedCollection(),
                    [collection2.id]: expectAuthorizedCollection(),
                },
                referencedAccounts: [await creatorSession.get()],
            },
        });

        expect(
            await testSubscribeToQuery(
                connection1,
                query(session1, {
                    limit: 10,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                }),
            ),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task3.id]: expectAuthorizedTask([publicCollection.id, collection3.id]),
                },
                backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
                referencedAccounts: [await creatorSession.get()],
            },
        });
    }

    {
        expect(
            await testSubscribeToQuery(
                connection2,
                query(session2, {
                    limit: 10,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                }),
            ),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task3.id]: expectAuthorizedTask([publicCollection.id, collection3.id]),
                    [task1.id]: expectAuthorizedTask([publicCollection.id]),
                },
                backfillCollections: {
                    [publicCollection.id]: expectAuthorizedCollection(),
                    [collection3.id]: expectAuthorizedCollection(),
                },
                referencedAccounts: [await creatorSession.get()],
            },
        });

        expect(
            await testSubscribeToQuery(
                connection2,
                query(session2, {
                    limit: 10,
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
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task2.id]: expectAuthorizedTask([publicCollection.id, collection2.id]),
                },
                backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
                referencedAccounts: [await creatorSession.get()],
            },
        });
    }

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    await commitTaskActionTransaction(creatorSession.action(), space.id, [
        {
            type: "UpdateTask",
            time: testClock.nowLogical(),
            taskId: task2.id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
        {
            type: "UpdateTask",
            time: testClock.nowLogical(),
            taskId: task1.id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
    ]);

    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);
    await task5.addCollection(session, collection);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());
    const connection3 = await server.connectForTest(session.action());

    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(
        await testSubscribeToQuery(connection3, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);

    await task4.addCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task4.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {},
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

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
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(
        await testSubscribeToQuery(connection3, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);

    await task4.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

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
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(
        await testSubscribeToQuery(connection3, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);

    await task4.removeCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

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
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [50, expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(
        await testSubscribeToQuery(connection3, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);

    await task4.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task4.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const collection = await TestTaskCollection.create(session);
    await collection.access.grantDefault(session);

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
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: [25, expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(
        await testSubscribeToQuery(connection3, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);
    expect(testTakeEvents(connection3)).toEqual([]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(testTakeEvents(connection3)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(
        connection1,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
                [task5.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
                [task5.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    await task2.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(await connection1.procedures.unsubscribeFromQuery({querySubscriptionId})).toEqual({});

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 0,
        }),
    ).toEqual({
        loadedState: {type: "Partial", endCursor: null},
        previouslyBackfilledTaskIds: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);
});

test("loading tasks with zero limit when there are no tasks", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    await server.wait();

    const connection = await server.connectForTest(session.action());

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 0,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1a.id, collection1b.id]),
                [task2.id]: expectAuthorizedTask([collection2a.id, collection2b.id]),
                [task3.id]: expectAuthorizedTask([collection3a.id, collection3b.id]),
            },
            backfillCollections: {
                [collection1a.id]: expectAuthorizedCollection(),
                [collection1b.id]: expectAuthorizedCollection(),
                [collection2a.id]: expectAuthorizedCollection(),
                [collection2b.id]: expectAuthorizedCollection(),
                [collection3a.id]: expectAuthorizedCollection(),
                [collection3b.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask([collection4a.id, collection4b.id]),
                [task5.id]: expectAuthorizedTask([collection5a.id, collection5b.id]),
            },
            backfillCollections: {
                [collection4a.id]: expectAuthorizedCollection(),
                [collection4b.id]: expectAuthorizedCollection(),
                [collection5a.id]: expectAuthorizedCollection(),
                [collection5b.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1a.id, collection1b.id]),
                [task2.id]: expectAuthorizedTask([collection2a.id, collection2b.id]),
                [task4.id]: expectAuthorizedTask([collection4a.id, collection4b.id]),
            },
            backfillCollections: {
                [collection1a.id]: expectAuthorizedCollection(),
                [collection1b.id]: expectAuthorizedCollection(),
                [collection2a.id]: expectAuthorizedCollection(),
                [collection2b.id]: expectAuthorizedCollection(),
                [collection4a.id]: expectAuthorizedCollection(),
                [collection4b.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task3.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task3.id]: expectAuthorizedTask([collection3a.id, collection3b.id])},
            backfillCollections: {
                [collection3a.id]: expectAuthorizedCollection(),
                [collection3b.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1a.id, collection1b.id]),
                [task2.id]: expectAuthorizedTask([collection2a.id, collection2b.id]),
                [task3.id]: expectAuthorizedTask([collection3a.id]),
                [task4.id]: expectAuthorizedTask([collection4a.id, collection4b.id]),
            },
            backfillCollections: {
                [collection1a.id]: expectAuthorizedCollection(),
                [collection1b.id]: expectAuthorizedCollection(),
                [collection2a.id]: expectAuthorizedCollection(),
                [collection2b.id]: expectAuthorizedCollection(),
                [collection3a.id]: expectAuthorizedCollection(),
                [collection4a.id]: expectAuthorizedCollection(),
                [collection4b.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task3.addCollection(session, collection3b);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {[collection3b.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection3a);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
        ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task3.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask([collection3.id]),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection3.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    const newCollectionOrderTime = testClock.nowLogical();

    await task1.updateCollectionPosition(session, collection1, {
        orderTime: newCollectionOrderTime,
        orderKey: initialOrderKey,
    });
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId: collection1.id,
                        position: {
                            orderTime: newCollectionOrderTime,
                            orderKey: initialOrderKey,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session, collection2);
    await task1.removeCollection(session, collection1);
    await server.wait();

    testTakeEvents(connection);

    await collection1.updateName(session, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session, "Test 4");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session, collection);
    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.addCollection(session, collection);
    await task2.removeCollection(session, collection);
    await collection.updateName(session, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session, collection);
    await collection.updateName(session, "Test 4");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Low"),
        task1.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("collections can be referenced, unreferenced, then referenced again", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.updatePriority(session, "Low"),
        task2.updatePriority(session, "Low"),
        task3.updatePriority(session, "Low"),
        task1.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection.updateName(session, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
                [parentTask5.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask2.id]: expectAuthorizedTask()},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection),
        task2.addCollection(session, collection),
        task3.addCollection(session, collection),
        task1.updateParentTask(session, parentTask1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask1.updatePriority(session, "Urgent");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask([collection.id]),
                [task5.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, null);
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask3.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user dedents:
    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user indents:
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask3.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask3.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [task3.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask3.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask3.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask3.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask3.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await parentTask3.updatePriority(session, "Urgent");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask([collection3.id]),
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
                [collection3.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(connection, {
        session,
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
    });

    expect(result).toEqual({
        loadedState: {type: "Partial", endCursor: [expect.any(Array), task3.id]},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testLoadMoreQueryTasks(connection, {
            clientTime: testClock.nowLogical(),
            querySubscriptionId,
            limit: 3,
        }),
    ).toEqual({
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task4.id]: expectAuthorizedTask([collection1.id]),
                [task5.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask3.id]: expectAuthorizedTask([collection3.id]),
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection3.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
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
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task1.updateParentTask(session, null);
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask2.id]: expectAuthorizedTask([collection2.id])},
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user dedents:
    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    // Action when the user indents:
    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
                [parentTask2.id]: expectAuthorizedTask([collection3.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
                [collection3.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection3.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask2.id]: expectAuthorizedTask([collection3.id])},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection3.updateName(session, "Test 4");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 5");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session),
            createPublicTestTaskCollection(session),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask(),
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updateParentTask(session, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {
                [parentTask2.id]: expectAuthorizedTask([collection2.id]),
                [parentTask1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    ]);

    await collection2.updateName(session, "Test 4");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);

    // Make sure `task3` is loaded in the store...
    await testSubscribeToQuery(
        connection2,
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
    const pausePromise1 = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `task2`.
    (await pausePromise2).unpause();

    expect(testTakeEvents(connection1)).toEqual([]);

    const pausePromise3 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Update to `task3` before `task2` has loaded.
    await task1.updateParentTask(session, task3);

    expect(testTakeEvents(connection1)).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause3} = await pausePromise3;

    expect(testTakeEvents(connection1)).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    expect(
        testTakeEvents(connection1).sort((a, b) => {
            assert(a.type === "Update");
            assert(b.type === "Update");
            return compareHybridLogicalTimes(
                a.defaultAuthorizationStateVersion,
                b.defaultAuthorizationStateVersion,
            );
        }),
    ).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[task2.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[task3.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);

    // Pause loading of `task4`...
    const pausePromise1 = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Make sure `task2` and `task3` are loaded in the store...
    void testSubscribeToQuery(
        connection2,
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

    const pausePromise3 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);
    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` which is blocked on loading `task4`.
    (await pausePromise3).unpause();

    expect(testTakeEvents(connection1)).toEqual([]);

    const pausePromise4 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Update to `task3` before `task4` has loaded.
    await task1.updateParentTask(session, task3);

    expect(testTakeEvents(connection1)).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause4} = await pausePromise4;

    expect(testTakeEvents(connection1)).toEqual([]);

    unpause1();
    unpause4();

    await waitPromise1;
    await waitPromise2;

    expect(
        testTakeEvents(connection1).sort((a, b) => {
            assert(a.type === "Update");
            assert(b.type === "Update");
            return compareHybridLogicalTimes(
                a.defaultAuthorizationStateVersion,
                b.defaultAuthorizationStateVersion,
            );
        }),
    ).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[task2.id]: expectAuthorizedTask(), [task4.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[task3.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("race condition: parent task is removed before it’s loaded", async () => {
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    // Pause loading of `task2`...
    const pausePromise1 = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

    const pausePromise2 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `task2`.
    (await pausePromise2).unpause();

    expect(testTakeEvents(connection)).toEqual([]);

    const pausePromise3 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Remove `task1` from loaded tasks.
    await task1.updateAssignee(session, null);

    expect(testTakeEvents(connection)).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `task3` update. But it's also
    // blocked on loading `task2`.
    const {unpause: unpause3} = await pausePromise3;

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updatePriority(session, "High");

    expect(testTakeEvents(connection)).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    expect(
        testTakeEvents(connection).sort((a, b) => {
            assert(a.type === "Update");
            assert(b.type === "Update");
            return compareHybridLogicalTimes(
                a.defaultAuthorizationStateVersion,
                b.defaultAuthorizationStateVersion,
            );
        }),
    ).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[task2.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("race condition: collection can be removed before previous collection has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, collection] = await runAllPromises([
        TestTask.create(session),
        createPublicTestTaskCollection(session),
    ]);

    await task1.updateAssignee(session, session);
    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);

    // Pause loading of `collection`...
    const pausePromise1 = taskRealtimeStoreBeforeLoadCollectionTestCheckpoint.pauseForTest(
        space.id,
    );

    const pausePromise2 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    await task1.addCollection(session, collection);
    const waitPromise1 = server.waitForApplyActionTransactions();
    const {unpause: unpause1} = await pausePromise1;

    // We've reached `eventBuilder.send()` which is blocked on loading `collection`.
    (await pausePromise2).unpause();

    expect(testTakeEvents(connection1)).toEqual([]);

    const pausePromise3 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Remove `collection` before `collection` has loaded.
    await task1.removeCollection(session, collection);

    expect(testTakeEvents(connection1)).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our `collection` remove. But it's
    // also blocked on loading `collection`.
    const {unpause: unpause3} = await pausePromise3;

    expect(testTakeEvents(connection1)).toEqual([]);

    unpause1();
    unpause3();

    await waitPromise1;
    await waitPromise2;

    expect(
        testTakeEvents(connection1)
            // Event order is not deterministic because both events depend on the
            // collection to load. `RemoveCollection` needs the collection to load so we
            // can tell if the collection is authorized or not.
            .sort((event1, event2) =>
                defaultCompareStrings(JSON.stringify(event1), JSON.stringify(event2)),
            ),
    ).toEqual(
        [
            {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
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
                backfillTasks: {},
                backfillCollections: {[collection.id]: expectAuthorizedCollection()},
                referencedAccounts: [],
            },
            {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
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
                backfillTasks: {},
                backfillCollections: {},
                referencedAccounts: [],
            },
        ].sort((event1, event2) =>
            defaultCompareStrings(JSON.stringify(event1), JSON.stringify(event2)),
        ),
    );

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);
});

test("race condition: parent task can change before previous collection of parent task has loaded", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.updateAssignee(session, session),
        task2.updatePriority(session, "High"),
        task2.addCollection(session, collection),
    ]);

    await server.wait();

    const connection1 = await server.connectForTest(session.action());
    const connection2 = await server.connectForTest(session.action());

    expect(testTakeEvents(connection1)).toEqual([]);
    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);

    // Pause loading of `collection`...
    const pausePromise1 = taskRealtimeStoreBeforeLoadCollectionTestCheckpoint.pauseForTest(
        space.id,
    );

    const pausePromise2 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Make sure `task2` is loaded in the store...
    void testSubscribeToQuery(
        connection2,
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

    const pausePromise3 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);
    await task1.updateParentTask(session, task2);
    const waitPromise1 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` which is blocked on loading `collection`.
    (await pausePromise3).unpause();

    expect(testTakeEvents(connection1)).toEqual([]);

    const pausePromise4 = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    // Remove parent before `collection` has loaded.
    await task1.updateParentTask(session, null);

    expect(testTakeEvents(connection1)).toEqual([]);

    const waitPromise2 = server.waitForApplyActionTransactions();

    // We've reached `eventBuilder.send()` for our update. But it's also
    // blocked on loading `collection`.
    const {unpause: unpause4} = await pausePromise4;

    expect(testTakeEvents(connection1)).toEqual([]);

    unpause1();
    unpause4();

    await waitPromise1;
    await waitPromise2;

    const compare = ({actions: actions1}: any, {actions: actions2}: any) =>
        defaultCompareStrings(
            actions1[0].taskAction.parentTaskId ?? "null",
            actions2[0].taskAction.parentTaskId ?? "null",
        );

    expect(testTakeEvents(connection1).sort(compare)).toEqual(
        [
            {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
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
                backfillTasks: {[task2.id]: expectAuthorizedTask([collection.id])},
                backfillCollections: {[collection.id]: expectAuthorizedCollection()},
                referencedAccounts: [await session.get()],
            },
            {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
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
                backfillTasks: {},
                backfillCollections: {},
                referencedAccounts: [],
            },
        ].sort(compare),
    );

    await collection.updateName(session, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);
});

test("multiple subscriptions that receive the same actions only show action once in update event", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const session = await space.createSession();

    const [task1, task2, task3, collection1, collection2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        createPublicTestTaskCollection(session),
        createPublicTestTaskCollection(session),
    ]);

    await runAllPromises([
        task1.addCollection(session, collection1),
        task2.addCollection(session, collection2),
        task3.addCollection(session, collection1),
        task3.addCollection(session, collection2),
    ]);

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [task3.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task2.id]: expectAuthorizedTask([collection2.id])},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task1.updateParentTask(session1, parentTask1),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task1.updateParentTask(session1, parentTask1),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.addCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    ]);

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.removeCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectUnauthorizedTask()},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
        task1.updateParentTask(session1, parentTask1),
        parentTask1.addCollection(session1, collection2),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.addCollection(session1, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.removeCollection(session1, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        parentTask1.addCollection(session1, collection),
    ]);

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
                [parentTask1.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session1, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.removeCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectUnauthorizedTask()},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection),
        task2.addCollection(session1, collection),
        task3.addCollection(session2, collection),
    ]);

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [task1.id, task2.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task3.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {},
            referencedAccounts: [await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.removeCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateAssignee(session1, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session1, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updatePriority(session1, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updatePriority(session2, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        parentTask1.addCollection(session2, collection),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask(), [task2.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [task1.id, task2.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session1, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updateParentTask(session1, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [task1.id, task2.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {[parentTask1.id]: expectUnauthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateParentTask(session1, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
            createPublicTestTaskCollection(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
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

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectAuthorizedTask([collection1.id]),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session1, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection3.updateName(session2, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session2),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask(), [task2.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [task1.id, task2.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session1, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session1, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection.updateName(session1, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        TestTaskCollection.create(session2),
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task1.addCollection(session1, collection2),
    ]);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection2.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [task1.id, task2.id],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: null,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session2, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updateCollectionPosition(session2, collection1, {
        orderTime: testClock.nowLogical(),
        orderKey: initialOrderKey,
    });
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.removeCollection(session2, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session2, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.addCollection(session2, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask([collection.id])},
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("will reauthorize an unauthorized referenced task to authorized and the new task has an unauthorized collection", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, parentTask1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        createPublicTestTaskCollection(session1),
        TestTaskCollection.create(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.addCollection(session2, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask([collection1.id])},
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("will reauthorize an unauthorized referenced task to authorized and the new task has an unauthorized collection that was previously authorized", async () => {
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
            TestTask.create(session2),
            createPublicTestTaskCollection(session1),
            createPublicTestTaskCollection(session2),
            TestTaskCollection.create(session2),
        ],
    );

    await task1.addCollection(session1, collection1);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection3);
    await task2.addCollection(session1, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection2.id]),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection2.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.addCollection(session2, collection2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.addCollection(session2, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectAuthorizedTask([collection1.id])},
            backfillCollections: {
                [collection2.id]: expectUnauthorizedCollection(),
                [collection1.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session2.get()],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.removeCollection(session2, collection);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[parentTask1.id]: expectUnauthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectUnauthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
    ]);

    await task1.addCollection(session1, collection);
    await task1.updateParentTask(session2, parentTask1);
    await parentTask1.addCollection(session2, collection);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection.id]),
                [task2.id]: expectAuthorizedTask(),
                [parentTask1.id]: expectAuthorizedTask([collection.id]),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await parentTask1.updatePriority(session2, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
        TestTaskCollection.create(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection2.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session1),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.access.grant(session2, session2);
    await collection2.access.revokeDefault(session2);
    await collection2.access.revoke(session1, session1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 2}],
                            ]),
                            defaultGrant: {level: "Manage", generation: 1},
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 2}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 2}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection2.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
        TestTaskCollection.create(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await task1.addCollection(session2, collection2);
    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id, collection2.id]),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection2.updateName(session2, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("if an unauthorized collection becomes authorized then all tasks in query that reference it are backfilled", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3, task4, collection1, collection2, collection3] =
        await runAllPromises([
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session1),
            TestTaskCollection.create(session2),
        ]);

    await collection2.access.grantDefault(session1);

    await collection1.access.grantDefault(session2);
    const {time: task3Collection1Time} = await task3.addCollection(session1, collection1);
    const {time: task4Collection1Time} = await task4.addCollection(session1, collection1);
    await collection1.access.revokeDefault(session2);

    await task1.addCollection(session1, collection2);
    await task2.addCollection(session1, collection2);
    await task3.addCollection(session1, collection2);
    await task4.addCollection(session1, collection2);

    const {time: task1Collection3Time} = await task1.addCollection(session2, collection3);
    const {time: task4Collection3Time} = await task4.addCollection(session2, collection3);

    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await server.wait();

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection2.id]),
                [task2.id]: expectAuthorizedTask([collection2.id]),
                [task3.id]: expectAuthorizedTask([collection2.id]),
                [task4.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection3.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task1Collection3Time,
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection3Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection1.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task3Collection1Time,
                    taskId: task3.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection1Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection3.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection3.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task1Collection3Time,
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection3Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);
});

test("if an unauthorized collection becomes authorized then all referenced tasks that reference it are backfilled", async () => {
    const space = await TestSpace.create(context);
    const server = createWebSocketServer(space);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [
        childTask1,
        childTask2,
        childTask3,
        childTask4,
        task1,
        task2,
        task3,
        task4,
        collection1,
        collection2,
        collection3,
    ] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session2),
    ]);

    await collection2.access.grantDefault(session1);

    await collection1.access.grantDefault(session2);
    const {time: task3Collection1Time} = await task3.addCollection(session1, collection1);
    const {time: task4Collection1Time} = await task4.addCollection(session1, collection1);
    await collection1.access.revokeDefault(session2);

    await childTask1.addCollection(session1, collection2);
    await childTask2.addCollection(session1, collection2);
    await childTask3.addCollection(session1, collection2);
    await childTask4.addCollection(session1, collection2);

    await collection3.access.grantDefault(session2);
    const {time: task1Collection3Time} = await task1.addCollection(session1, collection3);
    const {time: task4Collection3Time} = await task4.addCollection(session1, collection3);
    await collection3.access.revokeDefault(session2);

    await childTask1.updateParentTask(session1, task1);
    await childTask2.updateParentTask(session1, task2);
    await childTask3.updateParentTask(session1, task3);
    await childTask4.updateParentTask(session1, task4);

    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await server.wait();

    expect(
        await testSubscribeToQuery(
            connection,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [childTask1.id]: expectAuthorizedTask([collection2.id]),
                [childTask2.id]: expectAuthorizedTask([collection2.id]),
                [childTask3.id]: expectAuthorizedTask([collection2.id]),
                [childTask4.id]: expectAuthorizedTask([collection2.id]),
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection3.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task1Collection3Time,
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection3Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection1.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task3Collection1Time,
                    taskId: task3.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection1Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection3.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection3.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: task1Collection3Time,
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
                {
                    type: "UpdateTask",
                    time: task4Collection3Time,
                    taskId: task4.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection3.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session1),
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

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(
        await testSubscribeToQuery(connection1, {
            session: session1,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    server.evictAll();

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(1);

    expect(
        await testSubscribeToQuery(connection2, {
            session: session2,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection2.id]: expectAuthorizedCollection(),
                [collection1.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection2)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session1),
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

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(0);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(
        connection1,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    await connection1.procedures.unsubscribeFromQuery({
        querySubscriptionId,
    });

    expect(getCount()).toEqual(1);

    server.evictAll();

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(1);

    expect(
        await testSubscribeToQuery(connection2, {
            session: session2,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(2);

    expect(testTakeEvents(connection2)).toEqual([]);
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
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session1),
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

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(0);

    const {querySubscriptionId, ...result} = await testSubscribeToQuery(
        connection1,
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection1.id]: expectAuthorizedCollection(),
                [collection2.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    await connection1.procedures.unsubscribeFromQuery({
        querySubscriptionId,
    });

    expect(getCount()).toEqual(1);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    await collection2.updateName(session1, "Test 2");
    await server.wait();

    expect(testTakeEvents(connection1)).toEqual([]);

    expect(getCount()).toEqual(1);

    const connection2 = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(getCount()).toEqual(1);

    expect(
        await testSubscribeToQuery(connection2, {
            session: session2,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask([collection1.id]),
                [task2.id]: expectAuthorizedTask([collection1.id]),
                [task3.id]: expectAuthorizedTask([collection1.id]),
                [parentTask1.id]: expectAuthorizedTask([collection2.id]),
            },
            backfillCollections: {
                [collection2.id]: expectAuthorizedCollection(),
                [collection1.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session1.get()],
        },
    });

    expect(getCount()).toEqual(1);

    expect(testTakeEvents(connection2)).toEqual([]);
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

    expect(testTakeEvents(connection1)).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection1)).toEqual([]);

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();

    await expect(task3.updateParentTask(session, task1, {time: time2})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task’s `parentTaskId` would create a circular dependency",
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

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task3.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task1.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection2)).toEqual([]);

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

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task2.id]: expectAuthorizedTask(),
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    server.unpauseApplyActionTransactions();
    await server.wait();

    testTakeEvents(connection2);

    await task1.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([]);

    await task2.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task3.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([]);
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

    expect(testTakeEvents(connection1)).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: expect.any(Object),
    });

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();

    await expect(task3.updateParentTask(session, task1, {time: time2})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task’s `parentTaskId` would create a circular dependency",
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

    expect(testTakeEvents(connection2)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection2, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task5.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection2)).toEqual([]);

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

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task5.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task1.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task4.id]: expectAuthorizedTask(),
            },
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions1,
    });

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    server.unpauseApplyActionTransactions();
    await server.wait();

    testTakeEvents(connection2);

    await task1.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    ]);

    await task2.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([]);

    await task3.updateAssignee(session, session);
    await server.wait();

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
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

    expect(testTakeEvents(connection1)).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    //
    // However, we want to exclude `task2`!
    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: expect.any(Object),
    });

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();
    const time3 = testClock.nowLogical();

    await task1.updateParentTask(session, task2, {time: time1});

    await expect(task3.updateParentTask(session, task1, {time: time3})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task’s `parentTaskId` would create a circular dependency",
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

    const pause1Promise = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

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

    expect(testTakeEvents(connection2)).toEqual([]);

    const pause2Promise = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    const subscribePromise = testSubscribeToQuery(connection2, {
        session,
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
    });

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    expect(testTakeEvents(connection2)).toEqual([]);

    unpause1();
    await applyActions1Promise;
    const {updateEvent} = await subscribePromise;

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {
            [task5.id]: expectAuthorizedTask(),
            [task1.id]: expectAuthorizedTask(),
            [task3.id]: expectAuthorizedTask(),
            [task4.id]: expectAuthorizedTask(),
            [task2.id]: expectAuthorizedTask(),
        },
        backfillCollections: {},
        referencedAccounts: [await session.get()],
    });

    expect(testTakeEvents(connection2)).toEqual([]);

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

    expect(testTakeEvents(connection1)).toEqual([]);

    // We need to load `task1` and `task3` into the store before they're updated in
    // OpenSearch. Then we can control the order in which actions are applied in
    // OpenSearch.
    //
    // However, we want to exclude `task2`!
    expect(
        await testSubscribeToQuery(connection1, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: expect.any(Object),
    });

    server.pauseApplyActionTransactions();

    const time1 = testClock.nowLogical();
    const time2 = testClock.nowLogical();
    const time3 = testClock.nowLogical();

    await task1.updateParentTask(session, task2, {time: time1});

    await expect(task3.updateParentTask(session, task1, {time: time3})).rejects.toThrow(
        new FailedPreconditionError(
            "Updating task’s `parentTaskId` would create a circular dependency",
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

    const pause1Promise = taskRealtimeStoreBeforeLoadTaskTestCheckpoint.pauseForTest(space.id);

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

    expect(testTakeEvents(connection2)).toEqual([]);

    const pause2Promise = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    const subscribePromise = testSubscribeToQuery(connection2, {
        session,
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
    });

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

    const pause3Promise = taskRealtimeStoreBeforeSendEventTestCheckpoint.pauseForTest(space.id);

    const applyActions4Promise = server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions4,
    });

    const {unpause: unpause3} = await pause3Promise;
    unpause3();

    expect(testTakeEvents(connection2)).toEqual([]);

    unpause1();
    await applyActions1Promise;
    const {updateEvent} = await subscribePromise;
    await applyActions4Promise;

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {
            [task5.id]: expectAuthorizedTask(),
            [task1.id]: expectAuthorizedTask(),
            [task3.id]: expectAuthorizedTask(),
            [task4.id]: expectAuthorizedTask(),
            [task1.id]: expectAuthorizedTask(),
            [task3.id]: expectAuthorizedTask(),
            [task2.id]: expectAuthorizedTask(),
        },
        backfillCollections: {},
        referencedAccounts: [await session.get()],
    });

    expect(testTakeEvents(connection2)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await server.applyActionTransaction({
        spaceId: space.id,
        committedTime: testClock.nowDate(),
        actions: actions2,
    });
});

test("can subscribe to task", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {taskSubscriptionId, updateEvent} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task1.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task1.id]: expectAuthorizedTask()},
        backfillCollections: {},
        referencedAccounts: [await session.get()],
    });

    await task1.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task2.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.procedures.unsubscribeFromTask({taskSubscriptionId});

    await task1.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("can’t subscribe to task that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);
    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await expect(
        testSubscribeToTask(connection, {
            clientTime: testClock.nowLogical(),
            taskId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    expect(testTakeEvents(connection)).toEqual([]);
});

test("can’t subscribe to task that you don’t have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const task1 = await TestTask.create(session1);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await expect(
        testSubscribeToTask(connection, {
            clientTime: testClock.nowLogical(),
            taskId: task1.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(testTakeEvents(connection)).toEqual([]);
});

test("will lose access to subscribed task upon reauthorization", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const task1 = await TestTask.create(session1);
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await task1.addCollection(session1, collection1);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {taskSubscriptionId, updateEvent} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task1.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task1.id]: expectAuthorizedTask([collection1.id])},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session1.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(connection.isClosed()).toEqual(false);
    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.access.revokeDefault(session1);
    await server.wait();

    expect(connection.isClosed()).toEqual(false);

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: expect.any(Object),
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "TaskSubscriptionError",
            id: taskSubscriptionId,
            error: new PermissionDeniedError("Actor doesn’t have `View` access level to task"),
        },
    ]);

    await task1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("will lose access to subscribed task upon reauthorization if account removed from space", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const task1 = await TestTask.create(session1);
    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);
    await task1.addCollection(session1, collection1);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {taskSubscriptionId, updateEvent} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task1.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task1.id]: expectAuthorizedTask([collection1.id])},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session1.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.updatePriority(session1, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(connection.isClosed()).toEqual(false);
    expect(testTakeEvents(connection)).toEqual([]);

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    await expect(connection.authorize()).rejects.toThrow("Account doesn’t have access to space");

    expect(connection.isClosed()).toEqual(true);
    expect((connection.getCloseError() as any).message).toEqual(
        "Account doesn’t have access to space",
    );

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "TaskSubscriptionError",
            id: taskSubscriptionId,
            error: new PermissionDeniedError("Account doesn’t have access to space"),
        },
    ]);

    await task1.updatePriority(session1, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("subscribing to task subscribes to parent tasks and collections", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, task3, task4, collection1, collection2, collection3] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
        ]);

    await runAllPromises([
        task1.updateParentTask(session, task2),
        task2.updateParentTask(session, task3),
        task3.updateParentTask(session, task4),
        task2.addCollection(session, collection1),
        task2.addCollection(session, collection2),
        task4.addCollection(session, collection2),
        task4.addCollection(session, collection3),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {updateEvent} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task2.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {
            [task2.id]: expectAuthorizedTask([collection1.id, collection2.id]),
            [task3.id]: expectAuthorizedTask(),
            [task4.id]: expectAuthorizedTask([collection2.id, collection3.id]),
        },
        backfillCollections: {
            [collection1.id]: expectAuthorizedCollection(),
            [collection2.id]: expectAuthorizedCollection(),
            [collection3.id]: expectAuthorizedCollection(),
        },
        referencedAccounts: [await session.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task1.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task4.updatePriority(session, "Medium");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task4.id,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection1.updateName(session, "Collection 1a");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 1a",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Collection 2a");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 2a",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection3.updateName(session, "Collection 3a");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 3a",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task3.updateParentTask(session, null);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task4.id,
                    taskAction: expect.objectContaining({
                        type: "UpdateChildrenCounts",
                    }),
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await task4.updatePriority(session, "High");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session, "Collection 1b");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 1b",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Collection 2b");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 2b",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection3.updateName(session, "Collection 3b");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2.removeCollection(session, collection2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection1.updateName(session, "Collection 1c");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 1c",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Collection 2c");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection3.updateName(session, "Collection 3c");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await task3.updateParentTask(session, task4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task3.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: task4.id,
                    },
                },
            ],
            backfillTasks: {[task4.id]: expectAuthorizedTask([collection2.id, collection3.id])},
            backfillCollections: {
                [collection2.id]: expectAuthorizedCollection(),
                [collection3.id]: expectAuthorizedCollection(),
            },
            referencedAccounts: [await session.get()],
        },
    ]);

    await task4.updatePriority(session, "Low");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection1.updateName(session, "Collection 1d");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 1d",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Collection 2d");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection2.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 2d",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection3.updateName(session, "Collection 3d");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection3.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Collection 3d",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("subscribed task will become unauthorized after unsubscribed", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, task2, collection1] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        createPublicTestTaskCollection(session1),
    ]);

    await runAllPromises([
        task2.updateParentTask(session1, task1),
        task1.addCollection(session1, collection1),
        task2.addCollection(session1, collection1),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {taskSubscriptionId: taskSubscription1Id, updateEvent: updateEvent1} =
        await testSubscribeToTask(connection, {
            clientTime: testClock.nowLogical(),
            taskId: task1.id,
        });

    expect(updateEvent1).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task1.id]: expectAuthorizedTask([collection1.id])},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session1.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.removeCollection(session1, collection1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    const {updateEvent: updateEvent2} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task2.id,
    });

    expect(updateEvent2).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task2.id]: expectAuthorizedTask([collection1.id])},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session1.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.procedures.unsubscribeFromTask({
        taskSubscriptionId: taskSubscription1Id,
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectUnauthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);
});

test("can subscribe to collection", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);

    const [collection1, collection2] = await runAllPromises([
        TestTaskCollection.create(session),
        TestTaskCollection.create(session),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {collectionSubscriptionId, updateEvent} = await testSubscribeToCollection(connection, {
        clientTime: testClock.nowLogical(),
        collectionId: collection1.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session, "Test Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test Test 1",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection2.updateName(session, "Test Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await connection.procedures.unsubscribeFromCollection({collectionSubscriptionId});

    await collection1.updateName(session, "Test Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("can’t subscribe to collection that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const server = createWebSocketServer(space);
    await server.wait();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await expect(
        testSubscribeToCollection(connection, {
            clientTime: testClock.nowLogical(),
            collectionId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    expect(testTakeEvents(connection)).toEqual([]);
});

test("can’t subscribe to collection that you don’t have access to", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const collection1 = await TestTaskCollection.create(session1);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    await expect(
        testSubscribeToCollection(connection, {
            clientTime: testClock.nowLogical(),
            collectionId: collection1.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(testTakeEvents(connection)).toEqual([]);
});

test("will lose access to subscribed collection upon reauthorization", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const collection1 = await TestTaskCollection.create(session1);
    await collection1.access.grantDefault(session1);

    await server.wait();

    const connection = await server.connectForTest(session2.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {collectionSubscriptionId, updateEvent} = await testSubscribeToCollection(connection, {
        clientTime: testClock.nowLogical(),
        collectionId: collection1.id,
    });

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.updateName(session1, "Test Test 1");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test Test 1",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await connection.authorize();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection1.access.revokeDefault(session1);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: expect.any(Object),
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    await collection1.updateName(session1, "Test Test 2");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection1.id,
                    collectionAction: {
                        type: "UpdateName",
                        name: "Test Test 2",
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    expect(connection.isClosed()).toEqual(false);
    await connection.authorize();
    expect(connection.isClosed()).toEqual(false);

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "CollectionSubscriptionError",
            id: collectionSubscriptionId,
            error: new PermissionDeniedError(
                "Actor doesn’t have `View` access level to task collection",
            ),
        },
    ]);

    await collection1.updateName(session1, "Test Test 3");
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("subscribed collection will become unauthorized after unsubscribed", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const server = createWebSocketServer(space);

    const [task1, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        createPublicTestTaskCollection(session1),
        createPublicTestTaskCollection(session2),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task1.addCollection(session1, collection2),
    ]);

    await server.wait();

    const connection = await server.connectForTest(session1.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {collectionSubscriptionId, updateEvent: updateEvent1} = await testSubscribeToCollection(
        connection,
        {
            clientTime: testClock.nowLogical(),
            collectionId: collection2.id,
        },
    );

    expect(updateEvent1).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {},
        backfillCollections: {[collection2.id]: expectAuthorizedCollection()},
        referencedAccounts: [],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    const {updateEvent: updateEvent2} = await testSubscribeToTask(connection, {
        clientTime: testClock.nowLogical(),
        taskId: task1.id,
    });

    expect(updateEvent2).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {[task1.id]: expectAuthorizedTask([collection1.id, collection2.id])},
        backfillCollections: {[collection1.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session1.get()],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(connection.isClosed()).toEqual(false);
    expect(connection.getCloseError()).toEqual(null);

    await collection2.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
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
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "CollectionSubscriptionError",
            id: collectionSubscriptionId,
            error: new PermissionDeniedError(
                "Actor doesn’t have `View` access level to task collection",
            ),
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection2.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    expect(connection.isClosed()).toEqual(false);
});

test("deleting task and all children when subscribed to task and its children", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const collection = await TestTaskCollection.create(session);

    await runAllPromises([
        task2.updateParentTask(session, task1),
        task3.updateParentTask(session, task1),
        task4.updateParentTask(session, task1),
        task1.addCollection(session, collection),
        task5.addCollection(session, collection),
    ]);

    const server = createWebSocketServer(space);
    await server.wait();
    await ProcessContextModule.waitForTestTasks();

    const connection = await server.connectForTest(session.action());

    expect(testTakeEvents(connection)).toEqual([]);

    const {updateEvent} = await testSubscribe(connection, {
        clientTime: testClock.nowLogical(),
        queries: [
            {
                limit: 100,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    collectionsFilter: [
                        assertNonEmptyReadonlyMap(new Map([[collection.id, false]])),
                    ],
                },
                sorts: defaultTaskQueryNormalizedSorts,
            },
            {
                limit: 100,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task1.id,
                    },
                },
                sorts: defaultTaskQueryNormalizedSorts,
            },
        ],
        taskIds: [],
        collectionIds: [],
    });

    expect(testTakeEvents(connection)).toEqual([]);

    expect(updateEvent).toEqual({
        type: "Update",
        originClientId: null,
        defaultAuthorizationStateVersion: expect.any(Array),
        actions: [],
        backfillTasks: {
            [task1.id]: expectAuthorizedTask([collection.id]),
            [task2.id]: expectAuthorizedTask(),
            [task3.id]: expectAuthorizedTask(),
            [task4.id]: expectAuthorizedTask(),
            [task5.id]: expectAuthorizedTask([collection.id]),
        },
        backfillCollections: {[collection.id]: expectAuthorizedCollection()},
        referencedAccounts: [await session.get()],
    });

    await deleteTaskAndAllChildren(session.action(), task1.id, testClock.nowLogical());

    await server.wait();
});

test("will load some expanded task queries if requested", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const browserId = generateId<BrowserId>();

    const [
        task1,
        task2,
        task2a,
        task2b,
        task2b1,
        task2c,
        task3,
        task3a,
        task4a,
        task5,
        task5a,
        task5b,
        task6,
        task6a,
        task4,
        collection,
    ] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        createPublicTestTaskCollection(session2),
    ]);

    await task4.addCollection(session2, collection);

    await runAllPromises([
        task1.updatePriority(session1, "High"),
        task2.updatePriority(session1, "High"),
        task3.updatePriority(session1, "High"),
        task4.updatePriority(session1, "High"),
        task5.updatePriority(session1, "High"),
        task6.updatePriority(session1, "High"),
        task2a.updateParentTask(session1, task2),
        task2b.updateParentTask(session1, task2),
        task2c.updateParentTask(session1, task2),
        task2b1.updateParentTask(session1, task2b),
        task3a.updateParentTask(session1, task3),
        task4a.updateParentTask(session1, task4),
        task5a.updateParentTask(session1, task5),
        task5b.updateParentTask(session1, task5),
        task6a.updateParentTask(session1, task6),
    ]);

    const highPriorityQuery = query(session1, {
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ],
    });

    const server = createWebSocketServer(space);
    await server.wait();

    const gridViewExpansionState1: TaskGridViewExpansionState = new Map([
        [
            task2.id,
            {
                isExpanded: true,
                childTasks: new Map([
                    [task4.id, {isExpanded: true, childTasks: null}],
                    [task2b.id, {isExpanded: true, childTasks: null}],
                ]),
            },
        ],
        [task5.id, {isExpanded: true, childTasks: null}],
        [task6.id, {isExpanded: true, childTasks: null}],
    ]);

    await updateTaskGridViewExpansionState(session1.action(), {
        spaceId: space.id,
        browserId,
        filters: highPriorityQuery.filters,
        sorts: highPriorityQuery.sorts,
        state: gridViewExpansionState1,
    });

    {
        const connection = await server.connectForTest(context.action(session1));

        expect(testTakeEvents(connection)).toEqual([]);

        expect(
            await testSubscribeToQuery(connection, {
                ...highPriorityQuery,
                limit: 9,
            }),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task1.id]: expectAuthorizedTask(),
                    [task2.id]: expectAuthorizedTask(),
                    [task3.id]: expectAuthorizedTask(),
                    [task5.id]: expectAuthorizedTask(),
                    [task6.id]: expectAuthorizedTask(),
                },
                backfillCollections: {},
                referencedAccounts: [await session1.get()],
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }

    {
        const connection = await server.connectForTest(context.action(session1));

        expect(testTakeEvents(connection)).toEqual([]);

        expect(
            await testSubscribeToQuery(connection, {
                ...highPriorityQuery,
                limit: 9,
                shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
            }),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: gridViewExpansionState1,
            extraQueries: [
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task4.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2b.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task5.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
            ],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task1.id]: expectAuthorizedTask(),
                    [task2.id]: expectAuthorizedTask(),
                    [task3.id]: expectAuthorizedTask(),
                    [task5.id]: expectAuthorizedTask(),
                    [task6.id]: expectAuthorizedTask(),
                    [task2a.id]: expectAuthorizedTask(),
                    [task2b.id]: expectAuthorizedTask(),
                    [task2c.id]: expectAuthorizedTask(),
                    [task2b1.id]: expectAuthorizedTask(),
                    [task4.id]: expectAuthorizedTask([collection.id]),
                    [task4a.id]: expectAuthorizedTask(),
                    [task5a.id]: expectAuthorizedTask(),
                    [task5b.id]: expectAuthorizedTask(),
                },
                backfillCollections: {[collection.id]: expectAuthorizedCollection()},
                referencedAccounts: [await session1.get(), await session2.get()],
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }

    {
        const connection = await server.connectForTest(context.action(session1));

        expect(testTakeEvents(connection)).toEqual([]);

        // Subscribe to query once before so `previouslyBackfilledTaskIds` is populated.
        await testSubscribeToQuery(connection, {
            ...highPriorityQuery,
            limit: 9,
            shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
        });

        const result = await testSubscribeToQuery(connection, {
            ...highPriorityQuery,
            limit: 9,
            shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
        });

        expect(result).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [task1.id, task2.id, task3.id, task5.id, task6.id],
            gridViewExpansionState: gridViewExpansionState1,
            extraQueries: [
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [task2a.id, task2b.id, task2c.id],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task4.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [task4a.id],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2b.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [task2b1.id],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task5.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [task5a.id, task5b.id],
                },
            ],
            updateEvent: null,
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }

    await task4.removeCollection(session2, collection);
    await server.wait();

    {
        const connection = await server.connectForTest(context.action(session1));

        expect(testTakeEvents(connection)).toEqual([]);

        expect(
            await testSubscribeToQuery(connection, {
                ...highPriorityQuery,
                limit: 9,
                shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
            }),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: gridViewExpansionState1,
            extraQueries: [
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2b.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task5.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
            ],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task1.id]: expectAuthorizedTask(),
                    [task2.id]: expectAuthorizedTask(),
                    [task3.id]: expectAuthorizedTask(),
                    [task5.id]: expectAuthorizedTask(),
                    [task6.id]: expectAuthorizedTask(),
                    [task2a.id]: expectAuthorizedTask(),
                    [task2b.id]: expectAuthorizedTask(),
                    [task2c.id]: expectAuthorizedTask(),
                    [task2b1.id]: expectAuthorizedTask(),
                    [task5a.id]: expectAuthorizedTask(),
                    [task5b.id]: expectAuthorizedTask(),
                },
                backfillCollections: {},
                referencedAccounts: [await session1.get()],
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }

    const gridViewExpansionState2 = new Map([
        [
            task2.id,
            {
                isExpanded: true,
                childTasks: new Map([[task2b.id, {isExpanded: true, childTasks: null}]]),
            },
        ],
        [task5.id, {isExpanded: true, childTasks: null}],
        [task6.id, {isExpanded: true, childTasks: null}],
    ]);

    await updateTaskGridViewExpansionState(session1.action(), {
        spaceId: space.id,
        browserId,
        filters: highPriorityQuery.filters,
        sorts: highPriorityQuery.sorts,
        state: gridViewExpansionState2,
    });

    {
        const connection = await server.connectForTest(context.action(session1));

        expect(testTakeEvents(connection)).toEqual([]);

        expect(
            await testSubscribeToQuery(connection, {
                ...highPriorityQuery,
                limit: 9,
                shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
            }),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: gridViewExpansionState2,
            extraQueries: [
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task2b.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task5.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
                {
                    querySubscriptionId: expect.any(String),
                    filters: {
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: task6.id,
                        },
                    },
                    sorts: [
                        {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                        {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                    ],
                    limit: 9,
                    loadedState: {type: "Full"},
                    previouslyBackfilledTaskIds: [],
                },
            ],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task1.id]: expectAuthorizedTask(),
                    [task2.id]: expectAuthorizedTask(),
                    [task3.id]: expectAuthorizedTask(),
                    [task5.id]: expectAuthorizedTask(),
                    [task6.id]: expectAuthorizedTask(),
                    [task2a.id]: expectAuthorizedTask(),
                    [task2b.id]: expectAuthorizedTask(),
                    [task2c.id]: expectAuthorizedTask(),
                    [task2b1.id]: expectAuthorizedTask(),
                    [task5a.id]: expectAuthorizedTask(),
                    [task5b.id]: expectAuthorizedTask(),
                    [task6a.id]: expectAuthorizedTask(),
                },
                backfillCollections: {},
                referencedAccounts: [await session1.get()],
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }
});

test("race condition: extra query task ids includes task from action that happens during subscribe", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const browserId = generateId<BrowserId>();

    const [task1, task2, task2a, task2b, task3, collection] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTaskCollection.create(session),
    ]);

    await runAllPromises([
        task2a.updateParentTask(session, task2),
        task1.updatePriority(session, "High"),
        task2.updatePriority(session, "High"),
        task3.updatePriority(session, "High"),
        task2b.updatePriority(session, "Low"),
    ]);

    const highPriorityQuery = query(session, {
        filters: [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ],
    });

    const gridViewExpansionState: TaskGridViewExpansionState = new Map([
        [
            task2.id,
            {
                isExpanded: true,
                childTasks: null,
            },
        ],
    ]);

    await updateTaskGridViewExpansionState(session.action(), {
        spaceId: space.id,
        browserId,
        filters: highPriorityQuery.filters,
        sorts: highPriorityQuery.sorts,
        state: gridViewExpansionState,
    });

    const server = createWebSocketServer(space);
    await server.wait();

    const connection = await server.connectForTest(context.action(session));

    expect(testTakeEvents(connection)).toEqual([]);

    expect(
        await testSubscribeToQuery(connection, {
            session,
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
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task2b.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    const pausePromise1 = taskRealtimeStoreBeforeLoadCollectionTestCheckpoint.pauseForTest(
        space.id,
    );
    const pausePromise2 = taskRealtimeConnectionAfterSubscribeToQueryTestCheckpoint.pauseForTest(
        space.id,
    );

    const subscribePromise = testSubscribe(connection, {
        clientTime: testClock.nowLogical(),
        queries: [
            {
                ...highPriorityQuery,
                shouldLoadGridViewExpandedChildTasksForBrowserId: browserId,
            },
        ],
        taskIds: [],
        collectionIds: [collection.id],
    });

    const {unpause: unpause1} = await pausePromise1;
    const {unpause: unpause2} = await pausePromise2;

    // Make sure we've finished subscribing before updating the parent task.
    unpause2();

    expect(testTakeEvents(connection)).toEqual([]);

    await task2b.updateParentTask(session, task2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2.id,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        addedClosedChildTaskCount: 0,
                        removedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task2b.id,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: task2.id,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
    ]);

    unpause1();

    expect(await subscribePromise).toEqual({
        querySubscriptionResults: [
            {
                ok: true,
                querySubscriptionId: expect.any(String),
                loadedState: {type: "Full"},
                previouslyBackfilledTaskIds: [],
                gridViewExpansionState,
                extraQueries: [
                    {
                        querySubscriptionId: expect.any(String),
                        filters: {
                            displayStatusFilter: {
                                ifOpenInactive: true,
                                ifOpenActive: true,
                                ifClosed: true,
                            },
                            parentFilter: {
                                parentTaskId: task2.id,
                            },
                        },
                        sorts: [
                            {type: "ParentPosition", direction: "Ascending", missing: "Last"},
                            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
                        ],
                        limit: 100,
                        loadedState: {type: "Full"},
                        previouslyBackfilledTaskIds: [task2b.id],
                    },
                ],
            },
        ],
        taskSubscriptionResults: [],
        collectionSubscriptionResults: [
            {
                ok: true,
                collectionSubscriptionId: expect.any(String),
            },
        ],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask(),
                [task3.id]: expectAuthorizedTask(),
                [task2a.id]: expectAuthorizedTask(),
            },
            backfillCollections: {[collection.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);
});

test("private collections aren’t visible in task in query", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const server = createWebSocketServer(space);

    const [task1, task2, collection1, collection2, collection3, collection4] = await runAllPromises(
        [
            TestTask.create(session1),
            TestTask.create(session1),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
        ],
    );

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session1, session2);

    await task1.addCollection(session2, collection1);
    await task1.addCollection(session2, collection2);
    await task2.addCollection(session2, collection2);
    await task2.addCollection(session2, collection3);

    await collection3.access.grantDefault(session2);
    await collection4.access.grantDefault(session2);

    await server.wait();

    const connection = await server.connectForTest(context.action(session1));

    expect(
        await testSubscribeToQuery(
            connection,
            query(session1, {
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
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask([collection3.id]),
            },
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection4.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection4.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection4.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection4.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("private collections aren’t visible in referenced tasks", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const server = createWebSocketServer(space);

    const [
        childTask1,
        childTask2,
        task1,
        task2,
        collection1,
        collection2,
        collection3,
        collection4,
    ] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await childTask1.updateParentTask(session1, task1);
    await childTask2.updateParentTask(session1, task2);

    await childTask1.updatePriority(session1, "High");
    await childTask2.updatePriority(session1, "High");

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session1, session2);

    await task1.addCollection(session2, collection1);
    await task1.addCollection(session2, collection2);
    await task2.addCollection(session2, collection2);
    await task2.addCollection(session2, collection3);

    await collection3.access.grantDefault(session2);
    await collection4.access.grantDefault(session2);

    await server.wait();

    const connection = await server.connectForTest(context.action(session1));

    expect(
        await testSubscribeToQuery(
            connection,
            query(session1, {
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                    {
                        type: "Priority",
                        operation: {type: "OneOf", priorities: new Set(["High"])},
                    },
                ],
            }),
        ),
    ).toEqual({
        querySubscriptionId: expect.any(String),
        loadedState: {type: "Full"},
        previouslyBackfilledTaskIds: [],
        gridViewExpansionState: null,
        extraQueries: [],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {
                [childTask1.id]: expectAuthorizedTask(),
                [childTask2.id]: expectAuthorizedTask(),
                [task1.id]: expectAuthorizedTask(),
                [task2.id]: expectAuthorizedTask([collection3.id]),
            },
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection4.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection4.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection4.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection4.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("private collections aren’t visible in task subscription", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const server = createWebSocketServer(space);

    const [task1, task2, collection1, collection2, collection3, collection4] = await runAllPromises(
        [
            TestTask.create(session1),
            TestTask.create(session1),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
            TestTaskCollection.create(session2),
        ],
    );

    await task1.updateAssignee(session1, session2);
    await task2.updateAssignee(session1, session2);

    await task1.addCollection(session2, collection1);
    await task1.addCollection(session2, collection2);
    await task2.addCollection(session2, collection2);
    await task2.addCollection(session2, collection3);

    await collection3.access.grantDefault(session2);
    await collection4.access.grantDefault(session2);

    await server.wait();

    const connection = await server.connectForTest(context.action(session1));

    expect(
        await testSubscribeToTask(connection, {
            clientTime: testClock.nowLogical(),
            taskId: task1.id,
        }),
    ).toEqual({
        taskSubscriptionId: expect.any(String),
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task1.id]: expectAuthorizedTask()},
            backfillCollections: {},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(
        await testSubscribeToTask(connection, {
            clientTime: testClock.nowLogical(),
            taskId: task2.id,
        }),
    ).toEqual({
        taskSubscriptionId: expect.any(String),
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {[task2.id]: expectAuthorizedTask([collection3.id])},
            backfillCollections: {[collection3.id]: expectAuthorizedCollection()},
            referencedAccounts: [await session1.get(), await session2.get()],
        },
    });

    expect(testTakeEvents(connection)).toEqual([]);

    await task1.addCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection4.id,
                        orderKey: initialOrderKey,
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectAuthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await collection4.access.revokeDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [
                {
                    type: "UpdateCollection",
                    time: expect.any(Array),
                    collectionId: collection4.id,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ],
            backfillTasks: {},
            backfillCollections: {},
            referencedAccounts: [],
        },
        {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: {},
            backfillCollections: {[collection4.id]: expectUnauthorizedCollection()},
            referencedAccounts: [],
        },
    ]);

    await task1.removeCollection(session2, collection4);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);

    await collection4.access.grantDefault(session2);
    await server.wait();

    expect(testTakeEvents(connection)).toEqual([]);
});

test("task creator, closer, assigner, and assignee are correct", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, closerSession, assignerSession1, assignerSession2, assigneeSession] =
        await space.createSessions(5);

    const server = createWebSocketServer(space);

    const task = await TestTask.create(creatorSession);
    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    const {time: addCollectionTime} = await task.addCollection(creatorSession, collection);

    const {time: updateStatusTime} = await task.updateStatus(closerSession, "Closed");
    const {time: updateAssigneeTime1} = await task.updateAssignee(
        assignerSession1,
        assigneeSession,
    );

    await server.wait();

    {
        const connection = await server.connectForTest(context.action(creatorSession));

        expect(
            await testSubscribeToQuery(
                connection,
                query(creatorSession, {
                    filters: [
                        {
                            type: "Creator",
                            operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                            },
                        },
                    ],
                }),
            ),
        ).toEqual({
            querySubscriptionId: expect.any(String),
            loadedState: {type: "Full"},
            previouslyBackfilledTaskIds: [],
            gridViewExpansionState: null,
            extraQueries: [],
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task.id]: {
                        type: "Authorized",
                        task: new TaskModel({
                            id: task.id,
                            spaceId: space.id,
                            creator: {
                                accountId: creatorSession.account.id,
                                workingAccountName: creatorSession.account.initialName,
                                workingAccountNameVersion: 0,
                            },
                            createdTime: new TaskFilterableTime({
                                absoluteTime: task.createdTime,
                                setterTimeZone: defaultTimeZone,
                            }),
                            deletedTime: null,
                            undeletedTime: null,
                            parent: {
                                taskId: new TaskParentTaskIdRegister(null, task.createdTime),
                                position: new TaskPositionRegister(
                                    {orderTime: task.createdTime, orderKey: initialOrderKey},
                                    task.createdTime,
                                ),
                            },
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            collections: TaskCollectionSet.empty.apply({
                                type: "Set",
                                key: collection.id,
                                value: initialOrderKey,
                                version: addCollectionTime,
                            }),
                            positionByCollectionId: TaskPositionByCollectionIdMap.empty,
                            status: new TaskStatusWithSortableAccountRegister(
                                {
                                    type: "Closed",
                                    closer: {
                                        accountId: closerSession.account.id,
                                        workingAccountName: closerSession.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    closedTime: new TaskFilterableTime({
                                        absoluteTime: updateStatusTime,
                                        setterTimeZone: defaultTimeZone,
                                    }),
                                },
                                updateStatusTime,
                            ),
                            assignee: new TaskAssigneeWithSortableAccountRegister(
                                {
                                    assignee: {
                                        accountId: assigneeSession.account.id,
                                        workingAccountName: assigneeSession.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    assigner: {
                                        accountId: assignerSession1.account.id,
                                        workingAccountName: assignerSession1.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    assignedTime: new TaskFilterableTime({
                                        absoluteTime: updateAssigneeTime1,
                                        setterTimeZone: defaultTimeZone,
                                    }),
                                },
                                updateAssigneeTime1,
                            ),
                            assigneeStatus: new TaskAssigneeStatusRegister(
                                {type: "Inactive"},
                                updateAssigneeTime1,
                            ),
                            assigneePosition: new TaskAssigneePositionRegister(
                                null,
                                task.createdTime,
                            ),
                            title: new TaskTitleModel(emptyTaskTitle.get()),
                            dueDate: new TaskDueDateRegister(null, task.createdTime),
                            priority: new TaskPriorityRegister(null, task.createdTime),
                        }),
                    },
                },
                backfillCollections: {[collection.id]: expectAuthorizedCollection()},
                referencedAccounts: await runAllPromises([
                    creatorSession.get(),
                    closerSession.get(),
                    assigneeSession.get(),
                    assignerSession1.get(),
                ]),
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }

    const {time: updateAssigneeTime2} = await task.updateAssignee(
        assignerSession2,
        assigneeSession,
    );

    await server.wait();

    {
        const connection = await server.connectForTest(context.action(creatorSession));

        expect(
            await testSubscribeToTask(connection, {
                clientTime: testClock.nowLogical(),
                taskId: task.id,
            }),
        ).toEqual({
            taskSubscriptionId: expect.any(String),
            updateEvent: {
                type: "Update",
                originClientId: null,
                defaultAuthorizationStateVersion: expect.any(Array),
                actions: [],
                backfillTasks: {
                    [task.id]: {
                        type: "Authorized",
                        task: new TaskModel({
                            id: task.id,
                            spaceId: space.id,
                            creator: {
                                accountId: creatorSession.account.id,
                                workingAccountName: creatorSession.account.initialName,
                                workingAccountNameVersion: 0,
                            },
                            createdTime: new TaskFilterableTime({
                                absoluteTime: task.createdTime,
                                setterTimeZone: defaultTimeZone,
                            }),
                            deletedTime: null,
                            undeletedTime: null,
                            parent: {
                                taskId: new TaskParentTaskIdRegister(null, task.createdTime),
                                position: new TaskPositionRegister(
                                    {orderTime: task.createdTime, orderKey: initialOrderKey},
                                    task.createdTime,
                                ),
                            },
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            collections: TaskCollectionSet.empty.apply({
                                type: "Set",
                                key: collection.id,
                                value: initialOrderKey,
                                version: addCollectionTime,
                            }),
                            positionByCollectionId: TaskPositionByCollectionIdMap.empty,
                            status: new TaskStatusWithSortableAccountRegister(
                                {
                                    type: "Closed",
                                    closer: {
                                        accountId: closerSession.account.id,
                                        workingAccountName: closerSession.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    closedTime: new TaskFilterableTime({
                                        absoluteTime: updateStatusTime,
                                        setterTimeZone: defaultTimeZone,
                                    }),
                                },
                                updateStatusTime,
                            ),
                            assignee: new TaskAssigneeWithSortableAccountRegister(
                                {
                                    assignee: {
                                        accountId: assigneeSession.account.id,
                                        workingAccountName: assigneeSession.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    assigner: {
                                        accountId: assignerSession2.account.id,
                                        workingAccountName: assignerSession2.account.initialName,
                                        workingAccountNameVersion: 0,
                                    },
                                    assignedTime: new TaskFilterableTime({
                                        absoluteTime: updateAssigneeTime2,
                                        setterTimeZone: defaultTimeZone,
                                    }),
                                },
                                updateAssigneeTime2,
                            ),
                            assigneeStatus: new TaskAssigneeStatusRegister(
                                {type: "Inactive"},
                                updateAssigneeTime2,
                            ),
                            assigneePosition: new TaskAssigneePositionRegister(
                                null,
                                task.createdTime,
                            ),
                            title: new TaskTitleModel(emptyTaskTitle.get()),
                            dueDate: new TaskDueDateRegister(null, task.createdTime),
                            priority: new TaskPriorityRegister(null, task.createdTime),
                        }),
                    },
                },
                backfillCollections: {[collection.id]: expectAuthorizedCollection()},
                referencedAccounts: await runAllPromises([
                    creatorSession.get(),
                    closerSession.get(),
                    assigneeSession.get(),
                    assignerSession2.get(),
                ]),
            },
        });

        expect(testTakeEvents(connection)).toEqual([]);
    }
});
