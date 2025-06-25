import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
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
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TaskTitleModel, emptyTaskTitle} from "~/shared/tasks/title/task_title.js";

const context = createTestContext({shouldStartOpensearch: true});

async function testLoadTaskRealtimeQueries(
    actionContext: ServerActionContext,
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
    const {
        queries: queriesOutput,
        extraQueries,
        updateEvent,
    } = await loadTaskRealtimeQueries(actionContext, {
        server: server.server,
        dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
        spaceId,
        queries: queries.map(query => {
            const evaluationContext: TaskQueryEvaluationContext = {
                currentAccountId:
                    actionContext.actor.type === "Session"
                        ? actionContext.actor.getAccountId()
                        : null,
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
        taskIds: [],
        collectionIds: [],
    });

    expect(extraQueries).toEqual([]);
    expect(queriesOutput.map(({gridViewExpansionState}) => gridViewExpansionState)).toEqual(
        createArrayWithLength(queries.length, () => null),
    );

    return {
        loadedStates: queriesOutput.map(({loadedState}) => loadedState),
        updateEvent,
    };
}

function expectAuthorizedTask(taskId: TaskId, collectionIds: Array<TaskCollectionId> = []) {
    return expect.objectContaining({
        type: "Authorized",
        task: expect.objectContaining({
            id: taskId,
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

function expectUnauthorizedTask(taskId: TaskId) {
    return expect.objectContaining({
        type: "Unauthorized",
        taskId,
    });
}

function expectAuthorizedCollection(collectionId: TaskCollectionId) {
    return expect.objectContaining({
        type: "Authorized",
        collection: expect.objectContaining({id: collectionId}),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
            ],
            backfillCollections: [],
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
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
    ]);

    await collection1.access.grantDefault(session1);
    await collection2.access.grantDefault(session1);

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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection1.id),
            ],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task1.id, [collection1.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection1.id),
            ],
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

test("fails if account is removed from space", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();
    const server = new TestTaskRealtimeServer(context);

    await server.wait();

    await testLoadTaskRealtimeQueries(session2.action(), {
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
    });

    await removeSpaceAccount(session1.action(), {
        spaceId: space.id,
        accountId: session2.account.id,
    });

    await expect(
        testLoadTaskRealtimeQueries(session2.action(), {
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
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
            ],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(task4.id),
                expectAuthorizedTask(task5.id),
                expectAuthorizedTask(task6.id),
            ],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(task4.id),
                expectAuthorizedTask(task5.id),
            ],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(task4.id),
                expectAuthorizedTask(task5.id),
                expectAuthorizedTask(task6.id),
            ],
            backfillCollections: [],
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(parentTask1.id),
                expectAuthorizedTask(parentTask2.id),
                expectAuthorizedTask(parentTask3.id),
            ],
            backfillCollections: [],
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
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
            TestTaskCollection.create(session),
        ]);

    await collection1.access.grantDefault(session);
    await collection2.access.grantDefault(session);
    await collection3.access.grantDefault(session);

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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(parentTask1.id),
                expectAuthorizedTask(parentTask2.id, [collection3.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
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
            TestTaskCollection.create(session1),
        ]);

    await collection.access.grantDefault(session1);

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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection.id]),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(parentTask2.id, [collection.id]),
                expectUnauthorizedTask(parentTask1.id),
                expectUnauthorizedTask(parentTask4.id),
                expectUnauthorizedTask(parentTask3.id),
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
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
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
        TestTaskCollection.create(session2),
    ]);

    await collection1.access.grantDefault(session1);

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

    const loadResult = await testLoadTaskRealtimeQueries(session1.action(), {
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
    });

    expect({
        ...loadResult,
        updateEvent: {
            ...loadResult.updateEvent,
            // We've found the order of `backfillCollections` to be non-deterministic
            // causing this test to flake. So sort collections since order here doesn't
            // matter.
            backfillCollections: Array.from(loadResult.updateEvent.backfillCollections).sort(
                (collection1, collection2) =>
                    defaultCompareStrings(
                        collection1.type === "Authorized"
                            ? collection1.collection.id
                            : collection1.collectionId,
                        collection2.type === "Authorized"
                            ? collection2.collection.id
                            : collection2.collectionId,
                    ),
            ),
        },
    }).toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id]),
                expectAuthorizedTask(task2.id),
                expectAuthorizedTask(task3.id),
                expectAuthorizedTask(parentTask2.id, [collection1.id]),
                expectUnauthorizedTask(parentTask1.id),
                expectUnauthorizedTask(parentTask4.id),
                expectUnauthorizedTask(parentTask3.id),
            ],
            backfillCollections: [expectAuthorizedCollection(collection1.id)],
            referencedAccounts: [await session1.get()],
        },
    });
});

test("loads a query as an anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    const server = new TestTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5, collection1, collection2, collection3, collection4] =
        await runAllPromises([
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

    await task1.addCollection(session, collection1);
    await task3.addCollection(session, collection1);
    await task5.addCollection(session, collection1);

    await task1.updateParentTask(session, task2);
    await task5.updateParentTask(session, task3);

    await task1.addCollection(session, collection2);
    await task2.addCollection(session, collection2);
    await task3.addCollection(session, collection2);

    await task1.addCollection(session, collection3);
    await task5.addCollection(session, collection3);

    await task4.addCollection(session, collection4);

    await task1.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [expectAuthorizedTask(task4.id, [collection4.id])],
            backfillCollections: [expectAuthorizedCollection(collection4.id)],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
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
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task4.id, [collection4.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
                expectAuthorizedCollection(collection4.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
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
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
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
    ).rejects.toThrow("Account doesn’t have access to space");

    await collection1.access.grantUrl(session);

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [expectAuthorizedTask(task4.id, [collection4.id])],
            backfillCollections: [expectAuthorizedCollection(collection4.id)],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
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
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task4.id, [collection4.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
                expectAuthorizedCollection(collection4.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id]),
                expectAuthorizedTask(task3.id, [collection1.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
                expectUnauthorizedTask(task2.id),
            ],
            backfillCollections: [expectAuthorizedCollection(collection1.id)],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
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
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id]),
                expectAuthorizedTask(task3.id, [collection1.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
                expectUnauthorizedTask(task2.id),
            ],
            backfillCollections: [expectAuthorizedCollection(collection1.id)],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
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
    ).rejects.toThrow("Account doesn’t have access to space");

    await collection2.access.grantUrl(session);

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [expectAuthorizedTask(task4.id, [collection4.id])],
            backfillCollections: [expectAuthorizedCollection(collection4.id)],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(session.action(), {
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
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id, collection3.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task4.id, [collection4.id]),
                expectAuthorizedTask(task5.id, [collection1.id, collection3.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
                expectAuthorizedCollection(collection3.id),
                expectAuthorizedCollection(collection4.id),
            ],
            referencedAccounts: [await session.get()],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
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
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
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
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id, collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection1.id, collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([
                                    collection1.id,
                                    collection2.id,
                                    collection3.id,
                                ]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([
                                    collection1.id,
                                    collection2.id,
                                    collection3.id,
                                ]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: new Set(["Medium", "High"]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: new Set(["Medium", "High"]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id, collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection1.id, collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([
                                    collection1.id,
                                    collection2.id,
                                    collection3.id,
                                ]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([
                                    collection1.id,
                                    collection2.id,
                                    collection3.id,
                                ]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: new Set(["Medium", "High"]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task3.id, [collection1.id, collection2.id]),
                expectAuthorizedTask(task5.id, [collection1.id]),
            ],
            backfillCollections: [
                expectAuthorizedCollection(collection1.id),
                expectAuthorizedCollection(collection2.id),
            ],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: new Set(["Medium", "High"]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await collection1.access.revokeUrl(session);

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection2.id]),
            ],
            backfillCollections: [expectAuthorizedCollection(collection2.id)],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(context.anonymousAction(), {
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
    ).rejects.toThrow("Unauthenticated session");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection1.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection2.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).resolves.toEqual({
        loadedStates: [{type: "Full"}],
        updateEvent: {
            type: "Update",
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                expectAuthorizedTask(task1.id, [collection2.id]),
                expectAuthorizedTask(task2.id, [collection2.id]),
                expectAuthorizedTask(task3.id, [collection2.id]),
            ],
            backfillCollections: [expectAuthorizedCollection(collection2.id)],
            referencedAccounts: [],
        },
    });

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection3.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection4.id]),
                            },
                        },
                    ],
                },
            ],
        }),
    ).rejects.toThrow("Account doesn’t have access to space");

    await expect(
        testLoadTaskRealtimeQueries(otherSession.action(), {
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
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("task creator, closer, and assigner are obfuscated for anonymous actors but assignee is shared", async () => {
    const space = await TestSpace.create(context);
    const [creatorSession, closerSession, assignerSession1, assignerSession2, assigneeSession] =
        await space.createSessions(5);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const server = new TestTaskRealtimeServer(context);

    const task = await TestTask.create(creatorSession);
    const collection = await TestTaskCollection.create(creatorSession);
    await collection.access.grantDefault(creatorSession);
    await collection.access.grantUrl(creatorSession);
    const {time: addCollectionTime} = await task.addCollection(creatorSession, collection);

    const {time: updateStatusTime} = await task.updateStatus(closerSession, "Closed");
    const {time: updateAssigneeTime1} = await task.updateAssignee(
        assignerSession1,
        assigneeSession,
    );

    expect(
        await testLoadTaskRealtimeQueries(creatorSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([
                creatorSession.get(),
                closerSession.get(),
                assigneeSession.get(),
                assignerSession1.get(),
            ]),
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([assigneeSession.getStub()]),
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([assigneeSession.getStub()]),
        },
    });

    const {time: updateAssigneeTime2} = await task.updateAssignee(
        assignerSession2,
        assigneeSession,
    );

    expect(
        await testLoadTaskRealtimeQueries(creatorSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([
                creatorSession.get(),
                closerSession.get(),
                assigneeSession.get(),
                assignerSession2.get(),
            ]),
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([assigneeSession.getStub()]),
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([assigneeSession.getStub()]),
        },
    });

    const {time: updateAssigneeTime3} = await task.updateAssignee(assignerSession1, null);

    expect(
        await testLoadTaskRealtimeQueries(creatorSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
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
                            null,
                            updateAssigneeTime3,
                        ),
                        assigneeStatus: new TaskAssigneeStatusRegister(
                            {type: "Inactive"},
                            updateAssigneeTime3,
                        ),
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: await runAllPromises([creatorSession.get(), closerSession.get()]),
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(context.anonymousAction(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                            null,
                            updateAssigneeTime3,
                        ),
                        assigneeStatus: new TaskAssigneeStatusRegister(
                            {type: "Inactive"},
                            updateAssigneeTime3,
                        ),
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: [],
        },
    });

    expect(
        await testLoadTaskRealtimeQueries(otherSession.action(), {
            server,
            spaceId: space.id,
            queries: [
                {
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesAllOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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
            originClientId: null,
            defaultAuthorizationStateVersion: expect.any(Array),
            actions: [],
            backfillTasks: [
                {
                    type: "Authorized",
                    task: new TaskModel({
                        id: task.id,
                        spaceId: space.id,
                        creator: {
                            accountId: unknownAccountId,
                            workingAccountName: "Unknown",
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
                                    accountId: unknownAccountId,
                                    workingAccountName: "Unknown",
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
                            null,
                            updateAssigneeTime3,
                        ),
                        assigneeStatus: new TaskAssigneeStatusRegister(
                            {type: "Inactive"},
                            updateAssigneeTime3,
                        ),
                        assigneePosition: new TaskAssigneePositionRegister(null, task.createdTime),
                        title: new TaskTitleModel(emptyTaskTitle.get()),
                        dueDate: new TaskDueDateRegister(null, task.createdTime),
                        priority: new TaskPriorityRegister(null, task.createdTime),
                    }),
                },
            ],
            backfillCollections: [expectAuthorizedCollection(collection.id)],
            referencedAccounts: [],
        },
    });
});
