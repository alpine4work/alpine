import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import createJsonBigInt from "json-bigint";
import {SessionItem, getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {
    convertTaskQuerySortCursorToOpensearchCursor,
    getTaskQueryNormalizedSortsOpensearchSortClause,
} from "~/server/tasks/data/internal/get_task_query_normalized_sorts_opensearch_sort_clause.js";
import {TaskIndexDoc, TaskIndexDocType} from "~/server/tasks/data/task_index_doc.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/task_table.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId, generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {compareTaskQuerySortCursors} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

const JsonBigInt = createJsonBigInt({useNativeBigInt: true});

const baseContext = createTestContext({shouldStartOpensearch: true});

const context = {
    ...baseContext,
    action: session => {
        return baseContext.action(session).clone({
            tasks: new TestTaskContextModule({
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

async function testQuery(
    space: {id: SpaceId},
    sorts: Array<TaskQuerySort>,
): Promise<Array<TaskId>> {
    const normalizedSorts = normalizeTaskQuerySorts(sorts);
    return testQueryWithNormalizedSorts(space, normalizedSorts);
}

async function testQueryWithNormalizedSorts(
    space: {id: SpaceId},
    sorts: Array<TaskQueryNormalizedSort>,
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

    const [allTasks, sortedTasks] = await runAllPromiseThunks(
        async (): Promise<Array<TaskIndexDoc & {id: TaskId}>> => {
            // eslint-disable-next-line no-global-fetch
            const allHitsResponse = await fetch(
                `http://localhost:${context.getOpensearchLocalPort()}/tasks/_search?track_total_hits=false`,
                {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({
                        query: {term: {spaceId: space.id}},
                        sort: ["_id"],
                    }),
                },
            );

            const allHitsBody = await allHitsResponse.json();

            if (!allHitsResponse.ok) {
                throw new InternalError(`OpenSearch search failed: ${JSON.stringify(allHitsBody)}`);
            }

            return allHitsBody.hits.hits.map((hit: any) =>
                Object.assign(TaskIndexDocType.deserialize(hit._source), {id: hit._id}),
            );
        },
        async (): Promise<Array<TaskIndexDoc & {id: TaskId}>> => {
            // eslint-disable-next-line no-global-fetch
            const sortedHitsResponse = await fetch(
                `http://localhost:${context.getOpensearchLocalPort()}/tasks/_search?track_total_hits=false`,
                {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({
                        query: {term: {spaceId: space.id}},
                        sort: getTaskQueryNormalizedSortsOpensearchSortClause(sorts),
                    }),
                },
            );

            // We need to use `json-bigint` here so that the `sort` values are
            // parsed correctly.
            const sortedHitsBody = JsonBigInt.parse(await sortedHitsResponse.text());

            if (!sortedHitsResponse.ok) {
                throw new InternalError(
                    `OpenSearch search failed: ${JSON.stringify(sortedHitsBody)}`,
                );
            }

            return sortedHitsBody.hits.hits.map((hit: any) => {
                const task = Object.assign(TaskIndexDocType.deserialize(hit._source), {
                    id: hit._id,
                });

                // Make sure `convertTaskQuerySortCursorToOpensearchCursor()` produces the same
                // cursors as OpenSearch itself.
                expect(
                    convertTaskQuerySortCursorToOpensearchCursor(
                        sorts,
                        getTaskQueryNormalizedSortCursorFromIndexDoc(sorts, task),
                    ),
                ).toEqual(hit.sort);

                return task;
            });
        },
    );

    const expectedSortedTasks = [...allTasks].sort((task1, task2) => {
        const cursor1 = getTaskQueryNormalizedSortCursorFromIndexDoc(sorts, task1);
        const cursor2 = getTaskQueryNormalizedSortCursorFromIndexDoc(sorts, task2);
        return compareTaskQuerySortCursors(sorts, cursor1, cursor2);
    });

    // `getArray()` caches the underlying array. We don't want `expect().toEqual()`
    // to consider a difference in whether the array is cached or not so always
    // compute it.
    for (const task of [...sortedTasks, ...expectedSortedTasks]) {
        task.collections.raw.collections.getArray();
    }

    // Make sure our JavaScript filter implementation matches the OpenSearch filter
    // implementation.
    expect(sortedTasks).toEqual(expectedSortedTasks);

    return sortedTasks.map(({id}) => id);
}

test("sorts by created time by default", async () => {
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
    ]);

    expect(await testQuery(space, [])).toEqual([task1Id]);

    const time2 = clock.now();
    const time3: HybridLogicalTime = [time2[0] + 1, 0];
    clock.tick(time3);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [])).toEqual([task1Id, task2Id, task3Id]);

    const time4 = clock.now();
    const time5: HybridLogicalTime = [time4[0], time4[1] + 1];
    clock.tick(time5);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [])).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);
});

test("sort tiebreaks with task id", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const time = clock.now();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time,
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [])).toEqual(
        [task1Id, task2Id, task3Id, task4Id, task5Id].sort(),
    );
});

test("sorts by created time", async () => {
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
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Ascending"}])).toEqual([
        task1Id,
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Descending"}])).toEqual([
        task1Id,
    ]);

    const time2 = clock.now();
    const time3: HybridLogicalTime = [time2[0] + 1, 0];
    clock.tick(time3);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Descending"}])).toEqual([
        task3Id,
        task2Id,
        task1Id,
    ]);

    const time4 = clock.now();
    const time5: HybridLogicalTime = [time4[0], time4[1] + 1];
    clock.tick(time5);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "CreatedTime", direction: "Descending"}])).toEqual([
        task5Id,
        task4Id,
        task3Id,
        task2Id,
        task1Id,
    ]);
});

test("sorts by display status", async () => {
    const {space, session1} = await createScenario();

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
            taskId: task4Id,
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

    expect(await testQuery(space, [{type: "DisplayStatus", direction: "Ascending"}])).toEqual([
        task3Id,
        task4Id,
        task1Id,
        task2Id,
    ]);

    expect(await testQuery(space, [{type: "DisplayStatus", direction: "Descending"}])).toEqual([
        task2Id,
        task1Id,
        task3Id,
        task4Id,
    ]);
});

test("sorts by priority", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

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
            taskId: task6Id,
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
                priority: "Medium",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Urgent",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "High",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Low",
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "UpdatePriority",
                priority: "Medium",
            },
        },
    ]);

    expect(await testQuery(space, [{type: "Priority", direction: "Ascending"}])).toEqual([
        task4Id,
        task1Id,
        task6Id,
        task3Id,
        task2Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "Priority", direction: "Descending"}])).toEqual([
        task2Id,
        task3Id,
        task1Id,
        task6Id,
        task4Id,
        task5Id,
    ]);
});

test("sorts by assignee", async () => {
    const {space, session1, session2, session3} = await createScenario();

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
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session3),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(await testQuery(space, [{type: "Assignee", missing: "Last"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "Assignee", missing: "First"}])).toEqual([
        task5Id,
        task1Id,
        task2Id,
        task3Id,
        task4Id,
    ]);
});

test("sorts by creator", async () => {
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

    expect(await testQuery(space, [{type: "Creator"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
    ]);
});

test("sorts by assigner", async () => {
    const {space, session1, session2, session3} = await createScenario();

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
                    assignee: TaskSortableAccount.test(session1),
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
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session3),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(await testQuery(space, [{type: "Assigner", missing: "Last"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "Assigner", missing: "First"}])).toEqual([
        task5Id,
        task1Id,
        task2Id,
        task3Id,
        task4Id,
    ]);
});

test("sorts by due date", async () => {
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
                type: "UpdateDueDate",
                dueDate: toCalendarDate(
                    parseAbsolute(new Date(clock.now()[0]).toISOString(), "UTC"),
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
                    parseAbsolute(new Date(clock2.now()[0]).toISOString(), "UTC"),
                ),
            },
        },
    ]);

    const sharedDueDate = toCalendarDate(
        parseAbsolute(new Date(clock3.now()[0]).toISOString(), "UTC"),
    );

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "UpdateDueDate",
                dueDate: sharedDueDate,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateDueDate",
                dueDate: sharedDueDate,
            },
        },
    ]);

    expect(await testQuery(space, [{type: "DueDate", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "DueDate", direction: "Descending"}])).toEqual([
        task3Id,
        task4Id,
        task2Id,
        task1Id,
        task5Id,
    ]);
});

test("sorts by assigned time", async () => {
    const {space, session1, session2, session3} = await createScenario();

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
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session3),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(await testQuery(space, [{type: "AssignedTime", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "AssignedTime", direction: "Descending"}])).toEqual([
        task4Id,
        task3Id,
        task2Id,
        task1Id,
        task5Id,
    ]);
});

test("sorts by closed time", async () => {
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
                    closedTime: TaskFilterableTime.test(clock.now()),
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
                    closedTime: TaskFilterableTime.test(clock.now()),
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
                    closedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    expect(await testQuery(space, [{type: "ClosedTime", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task3Id,
        task4Id,
        task5Id,
    ]);

    expect(await testQuery(space, [{type: "ClosedTime", direction: "Descending"}])).toEqual([
        task4Id,
        task3Id,
        task2Id,
        task1Id,
        task5Id,
    ]);
});

test("sorts by activated time", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

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
            taskId: task6Id,
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
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
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
            taskId: task4Id,
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
            taskId: task5Id,
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
            taskId: task5Id,
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

    expect(await testQuery(space, [{type: "ActivatedTime", direction: "Ascending"}])).toEqual([
        task1Id,
        task2Id,
        task4Id,
        task5Id,
        task3Id,
        task6Id,
    ]);

    expect(await testQuery(space, [{type: "ActivatedTime", direction: "Descending"}])).toEqual([
        task5Id,
        task4Id,
        task2Id,
        task1Id,
        task3Id,
        task6Id,
    ]);
});

test("sorts by collection position", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();
    const task7Id = generateId<TaskId>();
    const task8Id = generateId<TaskId>();

    const collection1Id = generateId<TaskCollectionId>();
    const collection2Id = generateId<TaskCollectionId>();

    await commitTaskActionTransaction(context.action(session1), space.id, [
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
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();
    const time4 = clock.now();
    const time5 = clock.now();
    const time6 = clock.now();
    const time7 = clock.now();
    const time8 = clock.now();
    const time9 = clock.now();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: time6,
            taskId: task3Id,
            taskAction: {
                type: "UpdateCollectionPosition",
                collectionId: collection1Id,
                position: {orderTime: time2, orderKey: assertOrderKey("Zz")},
            },
        },
        {
            type: "UpdateTask",
            time: time7,
            taskId: task1Id,
            taskAction: {
                type: "UpdateCollectionPosition",
                collectionId: collection1Id,
                position: {orderTime: time7, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time8,
            taskId: task4Id,
            taskAction: {
                type: "UpdateCollectionPosition",
                collectionId: collection1Id,
                position: {orderTime: time8, orderKey: assertOrderKey("a1")},
            },
        },
        {
            type: "UpdateTask",
            time: time9,
            taskId: task5Id,
            taskAction: {
                type: "UpdateCollectionPosition",
                collectionId: collection1Id,
                position: {orderTime: time8, orderKey: assertOrderKey("a2")},
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection2Id,
                orderKey: assertOrderKey("a0"),
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "AddCollection",
                collectionId: collection1Id,
                orderKey: assertOrderKey("a0"),
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "CollectionPosition",
                collectionId: collection1Id,
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task8Id, task6Id, task7Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "CollectionPosition",
                collectionId: collection1Id,
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task8Id, task5Id, task4Id, task1Id, task2Id, task3Id, task6Id, task7Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "RemoveCollection",
                collectionId: collection1Id,
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "CollectionPosition",
                collectionId: collection1Id,
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task6Id, task7Id, task8Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "CollectionPosition",
                collectionId: collection1Id,
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task5Id, task4Id, task1Id, task2Id, task3Id, task6Id, task7Id, task8Id]);
});

test("sorts by parent position", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();
    const task7Id = generateId<TaskId>();
    const task8Id = generateId<TaskId>();

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
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
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
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask1Id,
            },
        },
    ]);

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();
    const time4 = clock.now();
    const time5 = clock.now();
    const time6 = clock.now();
    const time7 = clock.now();
    const time8 = clock.now();
    const time9 = clock.now();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time1, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time2, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time3, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time4, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time5, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time6,
            taskId: task3Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time2, orderKey: assertOrderKey("Zz")},
            },
        },
        {
            type: "UpdateTask",
            time: time7,
            taskId: task1Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time7, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time8,
            taskId: task4Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time8, orderKey: assertOrderKey("a1")},
            },
        },
        {
            type: "UpdateTask",
            time: time9,
            taskId: task5Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: time8, orderKey: assertOrderKey("a2")},
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: parentTask2Id,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateParentPosition",
                parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([
        parentTask1Id,
        parentTask2Id,
        task6Id,
        task3Id,
        task2Id,
        task1Id,
        task4Id,
        task5Id,
        task7Id,
        task8Id,
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual(
        [
            parentTask1Id,
            parentTask2Id,
            task6Id,
            task3Id,
            task2Id,
            task1Id,
            task4Id,
            task5Id,
            task7Id,
            task8Id,
        ].reverse(),
    );

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateParentTaskId",
                parentTaskId: null,
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([
        parentTask1Id,
        parentTask2Id,
        task6Id,
        task3Id,
        task1Id,
        task4Id,
        task5Id,
        task7Id,
        task8Id,
        task2Id,
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual(
        [
            parentTask1Id,
            parentTask2Id,
            task6Id,
            task3Id,
            task1Id,
            task4Id,
            task5Id,
            task7Id,
            task8Id,
            task2Id,
        ].reverse(),
    );
});

test("sorts by notepad page position", async () => {
    const {space, session1} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();
    const task7Id = generateId<TaskId>();
    const task8Id = generateId<TaskId>();

    const notepadPage1Id = generateTaskNotepadPageId();
    const notepadPage2Id = (notepadPage1Id + 1) as TaskNotepadPageId;

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateNotepadPage",
            time: clock.now(),
            accountId: session1.account.id,
            notepadPageId: notepadPage1Id,
            notepadPageAction: {
                type: "Create",
            },
        },
        {
            type: "UpdateNotepadPage",
            time: clock.now(),
            accountId: session1.account.id,
            notepadPageId: notepadPage2Id,
            notepadPageAction: {
                type: "Create",
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
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();
    const time4 = clock.now();
    const time5 = clock.now();
    const time6 = clock.now();
    const time7 = clock.now();
    const time8 = clock.now();
    const time9 = clock.now();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time1, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time2, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time3, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time4, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time5, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time6,
            taskId: task3Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time2, orderKey: assertOrderKey("Zz")},
            },
        },
        {
            type: "UpdateTask",
            time: time7,
            taskId: task1Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time7, orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: time8,
            taskId: task4Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time8, orderKey: assertOrderKey("a1")},
            },
        },
        {
            type: "UpdateTask",
            time: time9,
            taskId: task5Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: time8, orderKey: assertOrderKey("a2")},
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage2Id,
                accountId: session1.account.id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "NotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task8Id, task6Id, task7Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "NotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task8Id, task5Id, task4Id, task1Id, task2Id, task3Id, task6Id, task7Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateNotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                position: null,
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "NotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task6Id, task7Id, task8Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "NotepadPagePosition",
                notepadPageId: notepadPage1Id,
                accountId: session1.account.id,
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task5Id, task4Id, task1Id, task2Id, task3Id, task6Id, task7Id, task8Id]);
});

test("sorts by assignee status active position", async () => {
    const {space, session1, session2} = await createScenario();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();
    const task7Id = generateId<TaskId>();
    const task8Id = generateId<TaskId>();

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
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session1),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
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
                    assignee: TaskSortableAccount.test(session1),
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
                    assignee: TaskSortableAccount.test(session1),
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
                    assignee: TaskSortableAccount.test(session1),
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
                    assignee: TaskSortableAccount.test(session1),
                    assigner: TaskSortableAccount.test(session1),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session1),
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
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: TaskSortableAccount.test(session2),
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateAssignee",
                assignee: {
                    assignee: TaskSortableAccount.test(session2),
                    assigner: TaskSortableAccount.test(session2),
                    assignedTime: TaskFilterableTime.test(clock.now()),
                },
            },
        },
    ]);

    const time1 = clock.now();
    const time2 = clock.now();
    const time3 = clock.now();
    const time4 = clock.now();
    const time5 = clock.now();
    const time6 = clock.now();
    const time7 = clock.now();
    const time8 = clock.now();
    const time9 = clock.now();

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time1),
                    position: {orderTime: time1, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time2),
                    position: {orderTime: time2, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time3),
                    position: {orderTime: time3, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time4),
                    position: {orderTime: time4, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time5),
                    position: {orderTime: time5, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time6,
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time6),
                    position: {orderTime: time2, orderKey: assertOrderKey("Zz")},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time7,
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time7),
                    position: {orderTime: time7, orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time8,
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time8),
                    position: {orderTime: time8, orderKey: assertOrderKey("a1")},
                },
            },
        },
        {
            type: "UpdateTask",
            time: time9,
            taskId: task5Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(time9),
                    position: {orderTime: time8, orderKey: assertOrderKey("a2")},
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session2), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(clock.now()),
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        },
    ]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(clock.now()),
                    position: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Active",
                    activatedTime: TaskFilterableTime.test(clock.now()),
                    position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                },
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneeStatusActivePosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task7Id, task8Id, task6Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneeStatusActivePosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task8Id, task7Id, task5Id, task4Id, task1Id, task2Id, task3Id, task6Id]);

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateAssigneeStatus",
                assigneeStatus: {
                    type: "Inactive",
                },
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneeStatusActivePosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task7Id, task6Id, task8Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneeStatusActivePosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task7Id, task5Id, task4Id, task1Id, task2Id, task3Id, task6Id, task8Id]);
});
