import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {SessionItem, getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {evaluateTaskQueryNormalizedFiltersForIndexDoc} from "~/server/tasks/data/evaluate_task_query_normalized_filters_for_index_doc.js";
import {getTaskQueryNormalizedFiltersOpensearchQueryClause} from "~/server/tasks/data/internal/get_task_query_normalized_filters_opensearch_query_clause.js";
import {TaskIndexDoc, TaskIndexDocType} from "~/server/tasks/data/task_index_doc.js";
import {TestTasksContextModule} from "~/server/tasks/data/tasks_context_module.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/tasks_table.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId, generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskQueryFilter, TaskQueryFilterDateOperation} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";
import {
    sentenceTaskTitleTestScenario,
    wordTaskTitleTestScenario,
} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";

const baseContext = createTestContext({shouldStartOpensearch: true});

const context = {
    ...baseContext,
    action: session => {
        return baseContext.action(session).clone({
            tasks: new TestTasksContextModule({
                shouldSkipIndexing: false,
                dangerouslyEscalateToSystemContext: baseContext.escalateToSystemContext,
            }),
        });
    },
} satisfies TestContext;

// We create a new scenario for every test so we can query all tasks within
// a space.
async function createScenario() {
    const SpacesTable = getSpacesTableForTest();
    const AccountsTable = getAccountsTableForTest();

    const createdTime = new Date();

    const spaceId = generateId<SpaceId>();

    const account1Id = generateId<AccountId>();
    const account2Id = generateId<AccountId>();
    const account3Id = generateId<AccountId>();

    const account1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    const account1Item = {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: account1Id,
        name: "Account 1",
        createdTime,
    } as const;
    const account2Item = {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: account2Id,
        name: "Account 2",
        createdTime,
    } as const;
    const account3Item = {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: account3Id,
        name: "Account 3",
        createdTime,
    } as const;

    await runAllPromises([
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: spaceId,
            name: "Space",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account1Id,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account2Id,
            joinedTime: createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, account1Item),
        AccountsTable.createItem(context, account2Item),
        AccountsTable.createItem(context, account3Item),
        AccountsTable.createItem(context, account1SessionItem),
        AccountsTable.createItem(context, account2SessionItem),
        AccountsTable.createItem(context, account3SessionItem),
    ]);

    return {
        space: {id: spaceId},
        session1: {
            ...account1SessionItem,
            account: {id: account1Id, name: account1Item.name},
        },
        session2: {
            ...account2SessionItem,
            account: {id: account2Id, name: account2Item.name},
        },
        session3: {
            ...account3SessionItem,
            account: {id: account3Id, name: account3Item.name},
        },
    };
}

// 16:00 should be noon in `defaultTimeZone`.
const mockStartTime = new Date("2023-08-07T16:00:00.000Z").getTime();
const dayDurationMs = 1000 * 60 * 60 * 24;
const actualStartTime = Date.now();

// Start our clock at the beginning of an arbitrary day. This way when
// filtering around the current date we won't have bugs when running these
// tests around midnight.
const clock = new HybridLogicalClock({
    now: () => mockStartTime + (Date.now() - actualStartTime) - dayDurationMs * 4,
});

const clock2 = new HybridLogicalClock({
    now: () => mockStartTime + (Date.now() - actualStartTime) - dayDurationMs * 2,
});

const clock3 = new HybridLogicalClock({
    now: () => mockStartTime + (Date.now() - actualStartTime),
});

/**
 * Generate all the permutations of an array. Derived from [StackOverflow][1].
 *
 * [1]: https://stackoverflow.com/a/20871714/1568890
 */
function permutator<Item>(inputArray: ReadonlyArray<Item>): Array<Array<Item>> {
    const results: Array<Array<Item>> = [];

    const permute = (array: ReadonlyArray<Item>, result: Array<Item> = []) => {
        if (array.length === 0) {
            results.push(result);
        } else {
            for (let i = 0; i < array.length; i++) {
                const remainingArray = array.slice();
                const additionalResult = remainingArray.splice(i, 1);
                permute(remainingArray.slice(), result.concat(additionalResult));
            }
        }
    };

    permute(inputArray);

    return results;
}

async function testQuery(
    {account}: {account: {id: AccountId}},
    space: {id: SpaceId},
    filters: Array<TaskQueryFilter>,
): Promise<Array<TaskId>> {
    const executionContext = {
        currentAccountId: account.id,
        currentDate: toCalendarDate(
            parseAbsolute(new Date(mockStartTime - dayDurationMs * 2).toISOString(), "UTC"),
        ),
    };

    const normalizedFiltersResult = normalizeTaskQueryFilters(filters, executionContext);

    // The normalized filter result should always be the same no matter the order
    // of the `filters` array. This tells us that a `testQuery()` with any other
    // filter ordering would produce the same result.
    for (const filtersPermutation of permutator(filters)) {
        expect(normalizeTaskQueryFilters(filtersPermutation, executionContext)).toEqual(
            normalizedFiltersResult,
        );
    }

    if (normalizedFiltersResult.type === "Impossible") return [];
    const {normalizedFilters} = normalizedFiltersResult;

    return testQueryWithNormalizedFilters(space, normalizedFilters);
}

async function testQueryWithNormalizedFilters(
    space: {id: SpaceId},
    filters: TaskQueryNormalizedFilters,
): Promise<Array<TaskId>> {
    // Wait for any indexing processes to finish.
    await ProcessContextModule.waitForTestTasks();

    // We have to manually refresh OpenSearch in unit tests.
    {
        // eslint-disable-next-line no-global-fetch
        const response = await fetch(
            `http://localhost:${context.getOpensearchLocalPort()}/tasks/_refresh`,
            {method: "POST"},
        );

        if (!response.ok) {
            throw new InternalError(
                `OpenSearch refresh failed: ${JSON.stringify(await response.json())}`,
            );
        }
    }

    const [allTasks, queryTasks] = await runAllPromiseThunks(
        async (): Promise<Array<{id: TaskId; task: TaskIndexDoc}>> => {
            // eslint-disable-next-line no-global-fetch
            const allHitsResponse = await fetch(
                `http://localhost:${context.getOpensearchLocalPort()}/tasks/_search?track_total_hits=false`,
                {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({
                        query: {term: {spaceId: space.id}},
                        sort: ["createdTime.absoluteTime"],
                    }),
                },
            );

            const allHitsBody = await allHitsResponse.json();

            if (!allHitsResponse.ok) {
                throw new InternalError(`OpenSearch search failed: ${JSON.stringify(allHitsBody)}`);
            }

            return allHitsBody.hits.hits.map((hit: any) => ({
                id: hit._id,
                task: TaskIndexDocType.deserialize(hit._source),
            }));
        },
        async (): Promise<Array<{id: TaskId; task: TaskIndexDoc}>> => {
            // eslint-disable-next-line no-global-fetch
            const queryHitsResponse = await fetch(
                `http://localhost:${context.getOpensearchLocalPort()}/tasks/_search?track_total_hits=false`,
                {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({
                        query: getTaskQueryNormalizedFiltersOpensearchQueryClause(
                            space.id,
                            filters,
                        ),
                        sort: ["createdTime.absoluteTime"],
                    }),
                },
            );

            const queryHitsBody = await queryHitsResponse.json();

            if (!queryHitsResponse.ok) {
                throw new InternalError(
                    `OpenSearch search failed: ${JSON.stringify(queryHitsBody)}`,
                );
            }

            return queryHitsBody.hits.hits.map((hit: any) => ({
                id: hit._id,
                task: TaskIndexDocType.deserialize(hit._source),
            }));
        },
    );

    const expectedQueryTasks = allTasks.filter(({task}) =>
        evaluateTaskQueryNormalizedFiltersForIndexDoc(filters, task),
    );

    // `getArray()` caches the underlying array. We don't want `expect().toEqual()`
    // to consider a difference in whether the array is cached or not so always
    // compute it.
    for (const {task} of [...queryTasks, ...expectedQueryTasks]) {
        task.collections.raw.collections.getArray();
    }

    // Make sure our JavaScript filter implementation matches the OpenSearch filter
    // implementation.
    expect(queryTasks).toEqual(expectedQueryTasks);

    return queryTasks.map(({id}) => id);
}

test("searches all tasks in a space", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task1Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task1Id, task2Id, task3Id]);
});

test("searches a space with no tasks", async () => {
    const {space, session1} = await createScenario();

    expect(await testQuery(session1, space, [])).toEqual([]);
});

test("deleted tasks are filtered out", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task1Id, task2Id, task3Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Delete",
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task1Id, task3Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Delete",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Delete",
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Undelete",
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task2Id]);
});

test("closed tasks are filtered out by default", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(await testQuery(session1, space, [])).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {type: "DisplayStatus", operation: {type: "OneOf", displayStatuses: new Set()}},
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {type: "DisplayStatus", operation: {type: "NoneOf", displayStatuses: new Set()}},
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("can filter for closed tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ]),
    ).toEqual([task2Id]);
});

test("can filter for open tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed"])},
            },
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("can filter for open inactive tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed", "OpenActive"])},
            },
        ]),
    ).toEqual([task1Id]);
});

test("can filter for open active tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed", "OpenInactive"])},
            },
        ]),
    ).toEqual([task3Id]);
});

test("can filter for closed and open inactive tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed", "OpenInactive"])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);
});

test("can filter for closed and open active tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed", "OpenActive"])},
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for no statuses", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set([])},
            },
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                },
            },
        ]),
    ).toEqual([]);
});

test("can filter for all statuses", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set([]),
                },
            },
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("will merge multiple status filters", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateStatus",
                status: {
                    type: "Closed",
                    closer: TaskSortableAccount.test(session1),
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                    activatedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([task2Id]);
});

test("can filter by one of collections", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collection1Id])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collection2Id])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collection3Id])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([collection4Id])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection3Id, collection4Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("can filter by all of collections", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set([collection1Id])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set([collection2Id])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set([collection3Id])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set([collection4Id])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id, collection4Id]),
                },
            },
        ]),
    ).toEqual([]);
});

test("can filter by excludes all of collections", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set([collection1Id])},
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set([collection2Id])},
            },
        ]),
    ).toEqual([task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set([collection3Id])},
            },
        ]),
    ).toEqual([task1Id, task2Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set([collection4Id])},
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([task2Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id, collection4Id]),
                },
            },
        ]),
    ).toEqual([task2Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2Id, collection3Id, collection4Id]),
                },
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter by empty collections", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IsEmpty"},
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter against collections without providing collection ids", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set()},
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set()},
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set()},
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);
});

test("can merge collection filters in various ways", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();
    const collection3Id = generateId<TaskCollectionId>();
    const collection4Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection3Id,
                orderKey: initialOrderKey,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection3Id, collection4Id]),
                },
            },
        ]),
    ).toEqual([task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection2Id, collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id, collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection3Id, collection4Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection2Id, collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IsEmpty",
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IsEmpty",
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([collection2Id, collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection3Id]),
                },
            },
        ]),
    ).toEqual([task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection3Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection2Id]),
                },
            },
        ]),
    ).toEqual([task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection3Id]),
                },
            },
        ]),
    ).toEqual([task2Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IsEmpty",
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([collection1Id, collection2Id]),
                },
            },
            {
                type: "Collections",
                operation: {
                    type: "IsEmpty",
                },
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter for individual priorities", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set([null]),
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low"]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Medium"]),
                },
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["High"]),
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Urgent"]),
                },
            },
        ]),
    ).toEqual([task5Id]);
});

test("can filter for three priorities at once", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set([null, "Low", "Medium"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set([null, "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low", "Medium", "High"]),
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);
});

test("can negative filter for individual priorities", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set([null]),
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Low"]),
                },
            },
        ]),
    ).toEqual([task1Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Medium"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["High"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Urgent"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);
});

test("can negative filter for three priorities at once", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set([null, "Low", "Medium"]),
                },
            },
        ]),
    ).toEqual([task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set([null, "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Low", "Medium", "High"]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);
});

test("can filter for all priorities", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set([null, "Low", "Medium", "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);
});

test("can negative filter for all priorities", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set([null, "Low", "Medium", "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([]);
});

test("can merge priority filters", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdatePriority",
                priority: null,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low", "Medium"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Medium", "High"]),
                },
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low", "Medium", "High"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Medium", "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low", "Medium"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Medium", "High"]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set(["Low", "Medium", "High"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Medium", "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Low", "Medium"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Medium", "High"]),
                },
            },
        ]),
    ).toEqual([task1Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Low", "Medium", "High"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Medium", "High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["Low", "Medium"]),
                },
            },
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set(["High", "Urgent"]),
                },
            },
        ]),
    ).toEqual([task1Id]);
});

test("can filter for a single assignee account", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for multiple assignee accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);
});

test("can negative filter for a single assignee account", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);
});

test("can negative filter for multiple assignee accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter with empty assignee accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);
});

test("can merge assignee filters", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for a single creator account", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for multiple creator accounts", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
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
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);
});

test("can negative filter for a single creator account", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);
});

test("can negative filter for multiple creator accounts", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter with empty creator accounts", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);
});

test("can merge creator filters", async () => {
    const {space, session1, session2, session3} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session3), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session3),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
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
            {
                type: "Creator",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
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
            {
                type: "Creator",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for a single assigner account", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for multiple assigner accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);
});

test("can negative filter for a single assigner account", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session1.account.id}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);
});

test("can negative filter for multiple assigner accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "MissingAccount"}, {type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
        ]),
    ).toEqual([task4Id]);
});

test("can filter with empty assigner accounts", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [],
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id]);
});

test("can merge assigner filters", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const collectionId = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.account.id, {level: "Manage"}]]),
                    defaultGrant: {type: "Space", level: "Manage"},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId,
                orderKey: initialOrderKey,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session2, space, [
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", accountId: session2.account.id}],
                },
            },
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task1Id, task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Assigner",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", accountId: session1.account.id},
                        {type: "Account", accountId: session2.account.id},
                    ],
                },
            },
            {
                type: "Assigner",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "CurrentAccount"}],
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

type DateFilterTestCase = {
    name: string;
    extraFilters?: Array<TaskQueryFilter>;
    filter: (operation: TaskQueryFilterDateOperation) => TaskQueryFilter;
    setup: () => Promise<{
        session1: {account: {id: AccountId}};
        space: {id: SpaceId};
        task1Id: TaskId;
        task2Id: TaskId;
        task3Id: TaskId;
        task4Id: TaskId;
        task5Id?: TaskId;
    }>;
};

const dueDateFilterTestCase: DateFilterTestCase = {
    name: "due date",
    filter: operation => ({type: "DueDate", operation}),
    setup: async () => {
        const {session1, space} = await createScenario();

        const task1Id = generateId<TaskId>();
        const task2Id = generateId<TaskId>();
        const task3Id = generateId<TaskId>();
        const task4Id = generateId<TaskId>();
        const task5Id = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task1Id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session1),
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task2Id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session1),
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task3Id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session1),
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task4Id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session1),
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task5Id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session1),
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task1Id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: toCalendarDate(
                        parseAbsolute(new Date(clock.now()[0]).toISOString(), defaultTimeZone),
                    ),
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task2Id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: toCalendarDate(
                        parseAbsolute(new Date(clock2.now()[0]).toISOString(), defaultTimeZone),
                    ),
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task3Id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: toCalendarDate(
                        parseAbsolute(new Date(clock2.now()[0]).toISOString(), defaultTimeZone),
                    ),
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: task4Id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: toCalendarDate(
                        parseAbsolute(new Date(clock3.now()[0]).toISOString(), defaultTimeZone),
                    ),
                },
            },
        ]);

        return {
            session1,
            space,
            task1Id,
            task2Id,
            task3Id,
            task4Id,
            task5Id,
        };
    },
};

const dateFilterTestCases: Array<DateFilterTestCase> = [
    dueDateFilterTestCase,
    {
        name: "created time",
        filter: operation => ({type: "CreatedDate", operation}),
        setup: async () => {
            const {session1, space} = await createScenario();

            const task1Id = generateId<TaskId>();
            const task2Id = generateId<TaskId>();
            const task3Id = generateId<TaskId>();
            const task4Id = generateId<TaskId>();

            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock3.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]);

            return {
                session1,
                space,
                task1Id,
                task2Id,
                task3Id,
                task4Id,
            };
        },
    },
    {
        name: "assigned time",
        filter: operation => ({type: "AssignedDate", operation}),
        setup: async () => {
            const {session1, session2, space} = await createScenario();

            const task1Id = generateId<TaskId>();
            const task2Id = generateId<TaskId>();
            const task3Id = generateId<TaskId>();
            const task4Id = generateId<TaskId>();
            const task5Id = generateId<TaskId>();

            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock3.now()),
                        },
                    },
                },
            ]);

            return {
                session1,
                space,
                task1Id,
                task2Id,
                task3Id,
                task4Id,
                task5Id,
            };
        },
    },
    {
        name: "closed time",
        extraFilters: [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                },
            },
        ],
        filter: operation => ({type: "ClosedDate", operation}),
        setup: async () => {
            const {session1, space} = await createScenario();

            const task1Id = generateId<TaskId>();
            const task2Id = generateId<TaskId>();
            const task3Id = generateId<TaskId>();
            const task4Id = generateId<TaskId>();
            const task5Id = generateId<TaskId>();

            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closer: TaskSortableAccount.test(session1),
                            closedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closer: TaskSortableAccount.test(session1),
                            closedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closer: TaskSortableAccount.test(session1),
                            closedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closer: TaskSortableAccount.test(session1),
                            closedTime: TaskFilterableTime.test(clock3.now()),
                        },
                    },
                },
            ]);

            return {
                session1,
                space,
                task1Id,
                task2Id,
                task3Id,
                task4Id,
                task5Id,
            };
        },
    },
    {
        name: "activated time",
        filter: operation => ({type: "ActivatedDate", operation}),
        setup: async () => {
            const {session1, session2, space} = await createScenario();

            const task1Id = generateId<TaskId>();
            const task2Id = generateId<TaskId>();
            const task3Id = generateId<TaskId>();
            const task4Id = generateId<TaskId>();
            const task5Id = generateId<TaskId>();

            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "Create",
                        creator: TaskSortableAccount.test(session1),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assignee: TaskSortableAccount.test(session2),
                            assigner: TaskSortableAccount.test(session1),
                            assignedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task1Id,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            position: {orderTime: clock.now(), orderKey: initialOrderKey},
                            activatedTime: TaskFilterableTime.test(clock.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task2Id,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            position: {orderTime: clock.now(), orderKey: initialOrderKey},
                            activatedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: task3Id,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            position: {orderTime: clock.now(), orderKey: initialOrderKey},
                            activatedTime: TaskFilterableTime.test(clock2.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock3.now(),
                    taskId: task4Id,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            position: {orderTime: clock.now(), orderKey: initialOrderKey},
                            activatedTime: TaskFilterableTime.test(clock3.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock3.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            position: {orderTime: clock.now(), orderKey: initialOrderKey},
                            activatedTime: TaskFilterableTime.test(clock3.now()),
                        },
                    },
                },
                {
                    type: "UpdateTask",
                    time: clock3.now(),
                    taskId: task5Id,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: null,
                    },
                },
            ]);

            return {
                session1,
                space,
                task1Id,
                task2Id,
                task3Id,
                task4Id,
                task5Id,
            };
        },
    },
];

for (const {name, extraFilters = [], filter, setup} of dateFilterTestCases) {
    test(`can filter by ${name} around today`, async () => {
        const {session1, space, task1Id, task2Id, task3Id, task4Id} = await setup();

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({type: "LessThan", date: {type: "RelativeToday"}}),
            ]),
        ).toEqual([task1Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({type: "GreaterThan", date: {type: "RelativeToday"}}),
            ]),
        ).toEqual([task4Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 0}},
                }),
            ]),
        ).toEqual([task1Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 0}},
                }),
            ]),
        ).toEqual([task4Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 1}},
                }),
            ]),
        ).toEqual([task1Id, task2Id, task3Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 1}},
                }),
            ]),
        ).toEqual([task2Id, task3Id, task4Id]);
    });

    test(`can filter by ${name} with an absolute date`, async () => {
        const {session1, space, task1Id, task2Id, task3Id, task4Id, task5Id} = await setup();

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {
                        type: "Absolute",
                        date: null,
                    },
                }),
            ]),
        ).toEqual([task1Id, task2Id, task3Id, task4Id, ...(task5Id ? [task5Id] : [])]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {
                        type: "Absolute",
                        date: toCalendarDate(
                            parseAbsolute(
                                new Date(mockStartTime - dayDurationMs * 1).toISOString(),
                                defaultTimeZone,
                            ),
                        ),
                    },
                }),
            ]),
        ).toEqual([task1Id, task2Id, task3Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "GreaterThan",
                    date: {
                        type: "Absolute",
                        date: toCalendarDate(
                            parseAbsolute(
                                new Date(mockStartTime - dayDurationMs * 3).toISOString(),
                                defaultTimeZone,
                            ),
                        ),
                    },
                }),
            ]),
        ).toEqual([task2Id, task3Id, task4Id]);
    });

    test(`can merge ${name} filters`, async () => {
        const {session1, space, task1Id, task2Id, task3Id, task4Id} = await setup();

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 4}},
                }),
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 4}},
                }),
            ]),
        ).toEqual([task1Id, task2Id, task3Id, task4Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 1}},
                }),
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 1}},
                }),
            ]),
        ).toEqual([task2Id, task3Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 4}},
                }),
                filter({
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 1}},
                }),
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 1}},
                }),
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 4}},
                }),
            ]),
        ).toEqual([task2Id, task3Id]);

        expect(
            await testQuery(session1, space, [
                ...extraFilters,
                filter({
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 1}},
                }),
                filter({
                    type: "LessThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 1}},
                }),
            ]),
        ).toEqual([]);
    });
}

test("can filter by overdue due dates", async () => {
    const {session1, space, task1Id} = await dueDateFilterTestCase.setup();

    expect(
        await testQuery(session1, space, [{type: "DueDate", operation: {type: "Overdue"}}]),
    ).toEqual([task1Id]);
});

test("can filter by empty due dates", async () => {
    const {session1, space, task5Id} = await dueDateFilterTestCase.setup();

    expect(
        await testQuery(session1, space, [{type: "DueDate", operation: {type: "IsEmpty"}}]),
    ).toEqual([task5Id]);
});

test("can filter by title includes", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: wordTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateTitle",
                // "foo foo foobar"
                titleUpdate: decodeBase64(
                    "AAAG6cGihw8AAQAAAwcABBQRZG9jZm9vIGZvbyBmb29iYXIDDgMBAAABBgABAgAA",
                ) as TaskTitleUpdate,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "     ",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "Hello",
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "hello",
                },
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "brown",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "brow",
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "“brown”",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "(“brown”)",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: " (“brown”) ",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "32.3",
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "32",
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "3",
                },
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "foo",
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "foobar",
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "foo foobar",
                },
            },
        ]),
    ).toEqual([task4Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "bar",
                },
            },
        ]),
    ).toEqual([]);
});

test("can filter by title excludes", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: wordTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateTitle",
                // "foo foo foobar"
                titleUpdate: decodeBase64(
                    "AAAG6cGihw8AAQAAAwcABBQRZG9jZm9vIGZvbyBmb29iYXIDDgMBAAABBgABAgAA",
                ) as TaskTitleUpdate,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "     ",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "Hello",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "hello",
                },
            },
        ]),
    ).toEqual([task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "brown",
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "brow",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "“brown”",
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "(“brown”)",
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: " (“brown”) ",
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "32.3",
                },
            },
        ]),
    ).toEqual([task1Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "32",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "3",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "foo",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "foobar",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "foo foobar",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task5Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "bar",
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);
});

test("can merge title filters", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: wordTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: sentenceTaskTitleTestScenario.title4 as any as TaskTitleUpdate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateTitle",
                // "foo foo foobar"
                titleUpdate: decodeBase64(
                    "AAAG6cGihw8AAQAAAwcABBQRZG9jZm9vIGZvbyBmb29iYXIDDgMBAAABBgABAgAA",
                ) as TaskTitleUpdate,
            },
        },
    ]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "brown",
                },
            },
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "32.3",
                },
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Includes",
                    titleQuery: "brown",
                },
            },
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "32.3",
                },
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "brown",
                },
            },
            {
                type: "Title",
                operation: {
                    type: "Excludes",
                    titleQuery: "32.3",
                },
            },
        ]),
    ).toEqual([task1Id, task4Id, task5Id]);
});

test("can filter by parent task", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const parentTask1Id = generateId<TaskId>();
    const parentTask2Id = generateId<TaskId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: parentTask1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: parentTask2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask2Id,
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask2Id,
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedFilters(space, {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {parentTaskId: parentTask1Id},
        }),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQueryWithNormalizedFilters(space, {
            ...defaultTaskQueryNormalizedFilters,
            parentFilter: {parentTaskId: parentTask2Id},
        }),
    ).toEqual([task3Id, task5Id]);
});

test("can filter by notepad page", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const notepadPage1Id = generateTaskNotepadPageId();
    const notepadPage2Id = (notepadPage1Id + 1) as TaskNotepadPageId;

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                accountId: session1.account.id,
                notepadPageId: notepadPage1Id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                accountId: session1.account.id,
                notepadPageId: notepadPage1Id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                accountId: session1.account.id,
                notepadPageId: notepadPage2Id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                accountId: session2.account.id,
                notepadPageId: notepadPage2Id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedFilters(space, {
            ...defaultTaskQueryNormalizedFilters,
            notepadPageFilter: {accountId: session1.account.id, notepadPageId: notepadPage1Id},
        }),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQueryWithNormalizedFilters(space, {
            ...defaultTaskQueryNormalizedFilters,
            notepadPageFilter: {accountId: session1.account.id, notepadPageId: notepadPage2Id},
        }),
    ).toEqual([task3Id]);

    expect(
        await testQueryWithNormalizedFilters(space, {
            ...defaultTaskQueryNormalizedFilters,
            notepadPageFilter: {accountId: session2.account.id, notepadPageId: notepadPage2Id},
        }),
    ).toEqual([task5Id]);
});
