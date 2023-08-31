import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
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
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
} from "~/shared/tasks/task_realtime_protocol.js";

const context = createTestContext({shouldStartOpensearch: true});

async function testLoadTaskRealtimeQueries(
    actionContext: ServerSessionActionContext,
    {
        server,
        spaceId,
        queries,
    }: {
        server: TestTaskRealtimeServer;
        spaceId: SpaceId;
        queries: Array<{
            filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
            sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
            limit?: number;
        }>;
    },
): Promise<{
    loadedStates: Array<TaskRealtimeQueryLoadedState>;
    updateEvent: TaskRealtimeUpdateEvent;
}> {
    return loadTaskRealtimeQueries(actionContext, {
        server: server.server,
        dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
        spaceId,
        queries: queries.map(query => {
            const evaluationContext: TaskQueryEvaluationContext = {
                currentAccountId: actionContext.actor.getAccountId(),
                currentDate: toCalendarDate(
                    parseAbsolute(testClock.nowDate().toISOString(), defaultTimeZone),
                ),
            };

            const filters = query?.filters
                ? isReadonlyArray(query.filters)
                    ? normalizeTaskQueryFilters(query.filters, evaluationContext)
                    : ({type: "Possible", normalizedFilters: query.filters} as const)
                : normalizeTaskQueryFilters([], evaluationContext);

            assert(filters.type === "Possible");

            return {
                filters: filters.normalizedFilters,
                sorts: normalizeTaskQuerySorts(query?.sorts ?? []),
                limit: query?.limit ?? 100,
            };
        }),
    });
}

test("loads no queries", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [],
        }),
    ).toEqual({
        loadedStates: [],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    });
});

test("loads a query", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
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
    });
});

test("loads multiple queries", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, , task5, collection1, collection2] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPublic(session1),
    ]);

    await runAllPromises([
        task1.addCollection(session1, collection1),
        task2.addCollection(session2, collection2),
        task3.addCollection(session1, collection1),
        task3.addCollection(session1, collection2),
        task5.addCollection(session1, collection1),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task3.id}),
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
    });

    expect(
        await testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection2.id}),
                expect.objectContaining({id: collection1.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session2.get(), await session1.get()],
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}, {type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task5.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [
                expect.objectContaining({id: collection2.id}),
                expect.objectContaining({id: collection1.id}),
            ],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session2.get(), await session1.get()],
        },
    });
});

test("fails if query is unauthorized", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await expect(
        testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session2.account.id}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("fails if one query is unauthorized and one is authorized", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await testLoadTaskRealtimeQueries(session1.action(), {
        server,
        spaceId: space.id,
        queries: [
            {
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
            },
        ],
    });

    await expect(
        testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session2.account.id}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        ),
    );
});

test("queries may have different pagination states", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
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
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Partial", endCursor: expect.any(Array)}],
        updateEvent: {
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
    });

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
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
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Partial", endCursor: null}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [],
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task6.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    limit: 5,
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Partial", endCursor: expect.any(Array)}],
        updateEvent: {
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
    });

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
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
                },
                {
                    filters: [
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Partial", endCursor: expect.any(Array)}, {type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: task4.id}),
                expect.objectContaining({id: task5.id}),
                expect.objectContaining({id: task6.id}),
            ],
            backfillUnauthorizedTaskIds: [],
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    });
});

test("loads referenced parent tasks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await runAllPromises([
        task1.updateParentTask(session, parentTask1),
        task2.updateParentTask(session, parentTask2),
        parentTask2.updateParentTask(session, parentTask3),
        task3.updateParentTask(session, task1),
        task1.updateAssignee(session, session),
        task2.updateAssignee(session, session),
        task3.updateAssignee(session, session),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Assignee",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
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
            backfillAuthorizedCollections: [],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session.get()],
        },
    });
});

test("loads referenced collections", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

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
        task2.updateParentTask(session, parentTask1),
        parentTask1.updateParentTask(session, parentTask2),
        task1.updateAssignee(session, session),
        task2.updateAssignee(session, session),
        task3.updateAssignee(session, session),
        task1.addCollection(session, collection1),
        task1.addCollection(session, collection2),
        parentTask2.addCollection(session, collection3),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Assignee",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
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
    });
});

test("loads unauthorized parent tasks", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, parentTask1, parentTask2, parentTask3, parentTask4, collection] =
        await runAllPromises([
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session1),
            TestTask.create(session2),
            TestTask.create(session1),
            TestTask.create(session2),
            TestTask.create(session2),
            TestTaskCollection.createPublic(session1),
        ]);

    await task1.addCollection(session1, collection);
    await parentTask2.addCollection(session1, collection);

    await runAllPromises([
        task1.updateParentTask(session2, parentTask1),
        task2.updateParentTask(session1, parentTask2),
        parentTask2.updateParentTask(session2, parentTask3),
        parentTask3.updateParentTask(session2, parentTask4),
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task3.updateAssignee(session1, session1),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Assignee",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id, parentTask4.id, parentTask3.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection.id})],
            backfillUnauthorizedCollectionIds: [],
            referencedAccounts: [await session1.get()],
        },
    });
});

test("loads unauthorized collections", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [
        task1,
        task2,
        task3,
        parentTask1,
        parentTask2,
        parentTask3,
        parentTask4,
        collection1,
        collection2,
        collection3,
        collection4,
        collection5,
    ] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session2),
        TestTaskCollection.createPublic(session1),
        TestTaskCollection.createPrivate(session2),
        TestTaskCollection.createPrivate(session2),
        TestTaskCollection.createPrivate(session2),
        TestTaskCollection.createPrivate(session2),
    ]);

    await task1.addCollection(session1, collection1);
    await parentTask2.addCollection(session1, collection1);

    await runAllPromises([
        task1.updateParentTask(session2, parentTask1),
        task2.updateParentTask(session1, parentTask2),
        parentTask2.updateParentTask(session2, parentTask3),
        parentTask3.updateParentTask(session2, parentTask4),
        task1.updateAssignee(session1, session1),
        task2.updateAssignee(session1, session1),
        task3.updateAssignee(session1, session1),
        parentTask1.addCollection(session2, collection2),
        parentTask2.addCollection(session2, collection3),
        parentTask3.addCollection(session2, collection4),
        parentTask4.addCollection(session2, collection5),
    ]);

    await server.wait();

    expect(
        await testLoadTaskRealtimeQueries(session1.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Assignee",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "CurrentAccount"}],
                            },
                        },
                    ],
                },
            ],
        }),
    ).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            number: expect.any(Number),
            actions: [],
            backfillAuthorizedTasks: [
                expect.objectContaining({id: task1.id}),
                expect.objectContaining({id: task2.id}),
                expect.objectContaining({id: task3.id}),
                expect.objectContaining({id: parentTask2.id}),
            ],
            backfillUnauthorizedTaskIds: [parentTask1.id, parentTask4.id, parentTask3.id],
            backfillAuthorizedCollections: [expect.objectContaining({id: collection1.id})],
            backfillUnauthorizedCollectionIds: [
                collection2.id,
                collection3.id,
                collection4.id,
                collection5.id,
            ],
            referencedAccounts: [await session1.get()],
        },
    });
});
