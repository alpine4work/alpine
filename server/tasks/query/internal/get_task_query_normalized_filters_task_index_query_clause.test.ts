import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table.js";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table.js";
import {commitTaskSpaceActionTransaction} from "~/server/dynamo/tasks_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {TaskIndexDoc, TaskIndexDocType} from "~/server/tasks/index/task_index_doc.js";
import {evaluateTaskQueryNormalizedFiltersForTaskIndexDoc} from "~/server/tasks/query/internal/evaluate_task_query_normalized_filters_for_task_index_doc.js";
import {getTaskQueryNormalizedFiltersTaskIndexQueryClause} from "~/server/tasks/query/internal/get_task_query_normalized_filters_task_index_query_clause.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {normalizeTaskQueryFilters} from "~/shared/tasks/normalize_task_query_filters.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

const context = createTestContext({shouldStartOpensearch: true});

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
            accountId: account1Id,
            accountName: account1Item.name,
            item: account1SessionItem,
        },
        session2: {
            accountId: account2Id,
            accountName: account2Item.name,
            item: account2SessionItem,
        },
        session3: {
            accountId: account3Id,
            accountName: account3Item.name,
            item: account3SessionItem,
        },
    };
}

const mockStartTime = new Date("2023-08-07T00:00:00.000Z").getTime();
const actualStartTime = Date.now();

// Start our clock at the beginning of an arbitrary day. This way when
// filtering around the current date we won't have bugs when running these
// tests around midnight.
const clock = new HybridLogicalClock({
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
    {accountId}: {accountId: AccountId},
    space: {id: SpaceId},
    filters: Array<TaskQueryFilter>,
): Promise<Array<TaskId>> {
    const executionContext = {
        currentAccountId: accountId,
        currentDate: toCalendarDate(parseAbsolute(new Date(mockStartTime).toISOString(), "UTC")),
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

    console.log(
        JSON.stringify(
            {
                filters: normalizedFiltersResult,
                query:
                    normalizedFiltersResult.type === "Possible"
                        ? getTaskQueryNormalizedFiltersTaskIndexQueryClause(
                              space.id,
                              normalizedFiltersResult.normalizedFilters,
                          )
                        : null,
            },
            (key, value) =>
                value instanceof Set
                    ? Array.from(value)
                    : value instanceof Map
                    ? Object.fromEntries(value)
                    : value,
            2,
        ),
    );

    if (normalizedFiltersResult.type === "Impossible") return [];
    const {normalizedFilters} = normalizedFiltersResult;

    // Wait for any indexing processes to finish.
    await ProcessContextModule.waitForTestTasks();

    // We have to manually refresh. OpenSearch in unit tests.
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

            const allHitsBody = await allHitsResponse.json<any>();

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
                        query: getTaskQueryNormalizedFiltersTaskIndexQueryClause(
                            space.id,
                            normalizedFilters,
                        ),
                        sort: ["createdTime.absoluteTime"],
                    }),
                },
            );

            const queryHitsBody = await queryHitsResponse.json<any>();

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
        evaluateTaskQueryNormalizedFiltersForTaskIndexDoc(normalizedFilters, task),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            {type: "Status", operation: {type: "OneOf", statuses: new Set()}},
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {type: "Status", operation: {type: "NoneOf", statuses: new Set()}},
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("can filter for closed tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Closed"])}},
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ]),
    ).toEqual([task2Id]);
});

test("can filter for open tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["Closed"])},
            },
        ]),
    ).toEqual([task1Id, task3Id]);
});

test("can filter for open inactive tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["Closed", "OpenActive"])},
            },
        ]),
    ).toEqual([task1Id]);
});

test("can filter for open active tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["Closed", "OpenInactive"])},
            },
        ]),
    ).toEqual([task3Id]);
});

test("can filter for closed and open inactive tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["Closed", "OpenInactive"])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([task1Id, task2Id]);
});

test("can filter for closed and open active tasks", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["Closed", "OpenActive"])},
            },
        ]),
    ).toEqual([task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task2Id, task3Id]);
});

test("can filter for no statuses", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set([])},
            },
        ]),
    ).toEqual([task1Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {
                    type: "NoneOf",
                    statuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {
                    type: "OneOf",
                    statuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                },
            },
        ]),
    ).toEqual([task1Id, task2Id, task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {
                    type: "NoneOf",
                    statuses: new Set([]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task2Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["Closed"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "Closed"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task3Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive", "Closed"])},
            },
        ]),
    ).toEqual([task1Id]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive"])},
            },
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenActive"])},
            },
        ]),
    ).toEqual([]);

    expect(
        await testQuery(session1, space, [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive"])},
            },
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive"])},
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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

    await commitTaskSpaceActionTransaction(context.action(session1), space.id, [
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
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection1Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection3Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
                    defaultGrant: null,
                },
            },
        },
        {
            type: "UpdateTaskCollection",
            time: clock.now(),
            collectionId: collection4Id,
            collectionAction: {
                type: "Create",
                accessPolicy: {
                    accountGrantById: new Map([[session1.accountId, {level: "Manage"}]]),
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
