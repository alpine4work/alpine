import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import createJsonBigInt from "json-bigint";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {getTaskQueryNormalizedSortCursorForIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_for_index_doc.js";
import {
    convertTaskQuerySortCursorToOpensearchCursor,
    getTaskQueryNormalizedSortsOpensearchSortClause,
} from "~/server/tasks/data/internal/get_task_query_normalized_sorts_opensearch_sort_clause.js";
import {TaskIndexDoc, TaskIndexDocType} from "~/server/tasks/data/task_index_doc.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {compareTaskQuerySortCursors} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskTitleModel} from "~/shared/tasks/title/task_title.js";

const JsonBigInt = createJsonBigInt({useNativeBigInt: true});

const context = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

// 16:00 should be noon in `defaultTimeZone`.
const mockStartTime = new Date("2023-08-07T16:00:00.000Z").getTime();
const dayDurationMs = 1000 * 60 * 60 * 24;
const actualStartTime = Date.now();

// Start our clock at the beginning of an arbitrary day. This way when filtering
// around the current date we won't have bugs when running these tests around
// midnight.
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
    return await testQueryWithNormalizedSorts(space, normalizedSorts);
}

async function testQueryWithNormalizedSorts(
    space: {id: SpaceId},
    sorts: Array<TaskQueryNormalizedSort>,
): Promise<Array<TaskId>> {
    // Wait for any indexing processes to finish.
    await ProcessContextModule.waitForTestTasks();

    // We have to manually refresh OpenSearch in unit tests.
    {
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

    const [allTasks, sortedTasks1] = await runAllPromiseThunks(
        async (): Promise<Array<TaskIndexDoc & {id: TaskId}>> => {
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

            // We need to use `json-bigint` here so that the `sort` values are parsed
            // correctly.
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
                expect(hit.sort).toEqual(
                    convertTaskQuerySortCursorToOpensearchCursor(
                        sorts,
                        getTaskQueryNormalizedSortCursorForIndexDoc(sorts, task),
                    ),
                );

                return task;
            });
        },
    );

    const expectedSortedTasks1 = [...allTasks].sort((task1, task2) => {
        const cursor1 = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, task1);
        const cursor2 = getTaskQueryNormalizedSortCursorForIndexDoc(sorts, task2);
        return compareTaskQuerySortCursors(sorts, cursor1, cursor2);
    });

    const sortedTasks2 = sortedTasks1.map(task => convertTaskIndexDocToModel(task));

    const expectedSortedTasks2 = allTasks
        .map(task => convertTaskIndexDocToModel(task))
        .sort((task1, task2) => {
            const cursor1 = getTaskQueryNormalizedSortCursorForModel(sorts, task1);
            const cursor2 = getTaskQueryNormalizedSortCursorForModel(sorts, task2);
            return compareTaskQuerySortCursors(sorts, cursor1, cursor2);
        });

    // Make sure our JavaScript filter implementation for `TaskIndexDoc` matches the
    // OpenSearch filter implementation.
    expect(
        sortedTasks1.map(task => ({
            id: task.id,
            cursor: getTaskQueryNormalizedSortCursorForIndexDoc(sorts, task),
        })),
    ).toEqual(
        expectedSortedTasks1.map(task => ({
            id: task.id,
            cursor: getTaskQueryNormalizedSortCursorForIndexDoc(sorts, task),
        })),
    );

    // Make sure our JavaScript filter implementation for `TaskModel` matches the
    // OpenSearch filter implementation.
    expect(
        sortedTasks2.map(task => ({
            id: task.id,
            cursor: getTaskQueryNormalizedSortCursorForModel(sorts, task),
        })),
    ).toEqual(
        expectedSortedTasks2.map(task => ({
            id: task.id,
            cursor: getTaskQueryNormalizedSortCursorForModel(sorts, task),
        })),
    );

    return sortedTasks1.map(({id}) => id);
}

function convertTaskIndexDocToModel(task: TaskIndexDoc): TaskModel {
    return new TaskModel({
        id: task.id,
        spaceId: task.spaceId,
        creator: task.creator,
        createdTime: task.createdTime,
        deletedTime: task.rawDeletedTime,
        undeletedTime: task.rawUndeletedTime,
        parent: {
            taskId: task.parent.taskId,
            position: task.parent.rawPosition,
        },
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,
        accessPolicy: task.accessPolicy,
        collections: task.collections.raw.collections,
        positionByCollectionId: task.collections.raw.positionById,
        status: task.status,
        assignee: task.assignee,
        assigneeStatus: task.rawAssigneeStatus,
        assigneePosition: task.rawAssigneePosition,
        title: new TaskTitleModel(task.title.raw),
        dueDate: task.dueDate,
        priority: task.priority,
        layout: task.layout,
    });
}

test("sorts by created time by default", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [])).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);
});

test("sort tiebreaks with task id", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    expect(await testQuery(space, [])).toEqual(
        [task1Id, task2Id, task3Id, task4Id, task5Id].sort(),
    );
});

test("sorts by created time", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    closerId: session1.account.id,
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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

test("sorts by layout", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "UpdateLayout",
                layout: "Project",
            },
        },
    ]);

    expect(await testQuery(space, [{type: "Layout", missing: "Last"}])).toEqual([
        task2Id,
        task1Id,
        task3Id,
    ]);

    expect(await testQuery(space, [{type: "Layout", missing: "First"}])).toEqual([
        task1Id,
        task3Id,
        task2Id,
    ]);
});

test("sorts by assignee", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "a"}),
        space.createSession({name: "b"}),
        space.createSession({name: "c"}),
    ]);

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session2.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session2.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session3.account.id,
                    assignerId: session1.account.id,
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
    const space = await TestSpace.create(context);

    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "a"}),
        space.createSession({name: "b"}),
        space.createSession({name: "c"}),
    ]);

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
                creator: {accountId: session1.account.id, from: null},
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
                creator: {accountId: session2.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session2.account.id, from: null},
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
                creator: {accountId: session3.account.id, from: null},
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
    const space = await TestSpace.create(context);

    const [session1, session2, session3] = await runAllPromises([
        space.createSession({name: "a"}),
        space.createSession({name: "b"}),
        space.createSession({name: "c"}),
    ]);

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                creator: {accountId: session2.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session2.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session2.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session2.account.id,
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
                creator: {accountId: session3.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session3.account.id,
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
    const space = await TestSpace.create(context);

    const [session1, session2, session3] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
    ]);

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session2.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session2.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session3.account.id,
                    assignerId: session1.account.id,
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    closerId: session1.account.id,
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
                    closerId: session1.account.id,
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
                    closerId: session1.account.id,
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
                    closerId: session1.account.id,
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

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "First"},
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Descending", missing: "First"},
        ]),
    ).toEqual([task5Id, task4Id, task3Id, task2Id, task1Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "First",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "First"},
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "ParentPosition",
                direction: "Descending",
                missing: "First",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "First"},
        ]),
    ).toEqual([task1Id, task2Id, task3Id, task4Id, task5Id]);
});

test("sorts by activated time", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

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
                creator: {accountId: session1.account.id, from: null},
                name: "Test",
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            },
        },
        {
            type: "UpdateCollection",
            time: clock.now(),
            collectionId: collection2Id,
            collectionAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                name: "Test",
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: null,
                    urlGrant: null,
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();

    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();
    const task7Id = generateId<TaskId>();
    const task8Id = generateId<TaskId>();

    let parentTask1Id = generateId<TaskId>();
    let parentTask2Id = generateId<TaskId>();

    // Make sure `parentTask1Id` is always less than `parentTask2Id`.
    if (parentTask2Id < parentTask1Id) {
        [parentTask1Id, parentTask2Id] = [parentTask2Id, parentTask1Id];
    }

    await commitTaskActionTransaction(context.action(session1), space.id, [
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: parentTask1Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: parentTask2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task1Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
        task6Id,
        task3Id,
        task2Id,
        task1Id,
        task4Id,
        task5Id,
        task7Id,
        task8Id,
        parentTask1Id,
        parentTask2Id,
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
    ).toEqual([
        task8Id,
        task7Id,
        task5Id,
        task4Id,
        task1Id,
        task2Id,
        task3Id,
        task6Id,
        parentTask1Id,
        parentTask2Id,
    ]);

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
        task6Id,
        task3Id,
        task1Id,
        task4Id,
        task5Id,
        task7Id,
        task8Id,
        parentTask1Id,
        parentTask2Id,
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
    ).toEqual([
        task8Id,
        task7Id,
        task5Id,
        task4Id,
        task1Id,
        task3Id,
        task6Id,
        parentTask1Id,
        parentTask2Id,
        task2Id,
    ]);
});

test("sorts by assignee position", async () => {
    const space = await TestSpace.create(context);

    const sessions = await runAllPromises([space.createSession(), space.createSession()]);

    let session1;
    let session2;
    if (sessions[0].account.id < sessions[1].account.id) {
        session1 = sessions[0];
        session2 = sessions[1];
    } else {
        session1 = sessions[1];
        session2 = sessions[0];
    }

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
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task2Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task3Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task4Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task5Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task6Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                    assigneeId: session1.account.id,
                    assignerId: session1.account.id,
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
                creator: {accountId: session2.account.id, from: null},
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
                    assigneeId: session2.account.id,
                    assignerId: session2.account.id,
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time1,
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time1, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time2,
            taskId: task2Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time2, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time3,
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time3, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time4,
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time4, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time5,
            taskId: task5Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time5, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time6,
            taskId: task3Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time2, orderKey: assertOrderKey("Zz")},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time7,
            taskId: task1Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time7, orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time8,
            taskId: task4Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time8, orderKey: assertOrderKey("a1")},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: time9,
            taskId: task5Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: time8, orderKey: assertOrderKey("a2")},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task7Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session2.account.id,
                position: {orderTime: clock.now(), orderKey: initialOrderKey},
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
                },
            },
        },
        {
            type: "UpdateTask",
            time: clock.now(),
            taskId: task8Id,
            taskAction: {
                type: "UpdateAssigneePosition",
                accountId: session1.account.id,
                position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
            },
        },
    ]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneePosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task7Id, task8Id, task6Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneePosition",
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
                type: "AssigneePosition",
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task3Id, task2Id, task1Id, task4Id, task5Id, task7Id, task8Id, task6Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneePosition",
                direction: "Descending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task8Id, task7Id, task5Id, task4Id, task1Id, task2Id, task3Id, task6Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneePosition",
                direction: "Ascending",
                missing: "First",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task6Id, task3Id, task2Id, task1Id, task4Id, task5Id, task7Id, task8Id]);

    expect(
        await testQueryWithNormalizedSorts(space, [
            {
                type: "AssigneePosition",
                direction: "Descending",
                missing: "First",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ]),
    ).toEqual([task6Id, task8Id, task7Id, task5Id, task4Id, task1Id, task2Id, task3Id]);
});
