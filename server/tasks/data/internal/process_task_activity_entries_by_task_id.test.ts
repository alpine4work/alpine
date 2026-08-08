import {addMinutes} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {getTaskActivityEntries} from "~/server/tasks/data/get_task_activity_entries.js";
import {
    processTaskActivityEntriesByTaskId,
    processTaskActivityEntryGroupsBeforeTransactionTestCheckpoint,
} from "~/server/tasks/data/internal/process_task_activity_entries_by_task_id.js";
import {
    TaskActivityEntryChange,
    TaskActivityTable,
} from "~/server/tasks/data/internal/task_activity_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {generateId, getMaxId, getMinId} from "~/shared/id/id.open_source.js";
import {
    TaskActionTransactionId,
    TaskActivityEntryId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityModel,
} from "~/shared/tasks/task_activity.js";

const context = createTestContext({spacesInjection, tasksInjection});
const space = createTestSpace(context);
const session = createTestSession(context, space);
const actor = {accountId: session.accountId, from: null} as const;

async function createTask(): Promise<TaskId> {
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(context.action(session), space.id, [
        {
            type: "UpdateTask",
            time: [currentTime, 0],
            taskId,
            taskAction: {
                type: "Create",
                creator: {accountId: session.accountId, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        },
    ]);

    await ProcessContextModule.waitForTestTasks();

    // Activity is emitted during OpenSearch indexing, which is disabled in this test
    // environment. Project the `TaskCreated` group directly so the entry exists like
    // it would in production.
    await processEntryGroup({
        taskId,
        activityTime: new Date(currentTime),
        changes: [{type: "TaskCreated"}],
    });

    return taskId;
}

/**
 * Projects one task's changes as a single entry group, stamping each change's
 * action time from `activityTime`. Generates a fresh action transaction id unless
 * the test needs a stable one for replay or racing scenarios.
 */
function processEntryGroup({
    actionTransactionId = generateId<TaskActionTransactionId>(),
    taskId,
    activityTime,
    changes,
}: {
    actionTransactionId?: TaskActionTransactionId;
    taskId: TaskId;
    activityTime: Date;
    changes: ReadonlyArray<DistributiveOmit<TaskActivityEntryChange, "actionTime">>;
}) {
    return processTaskActivityEntriesByTaskId(
        context.action(session),
        space.id,
        actor,
        actionTransactionId,
        new Map<TaskId, ReadonlyArray<TaskActivityEntryChange>>([
            [
                taskId,
                changes.map((change, changeIndex) => ({
                    ...change,
                    actionTime: [activityTime.getTime(), changeIndex],
                })),
            ],
        ]),
    );
}

// Entries come back in entry id (projection) order; sort by their first action
// time before asserting order.
function sortEntryModels(
    items: ReadonlyArray<{model: TaskActivityModel}>,
): Array<TaskActivityFeedDiscreteEntryModel> {
    return items
        .map(item => item.model)
        .filter(model => model instanceof TaskActivityFeedDiscreteEntryModel)
        .sort((entry1, entry2) => {
            const change1 = entry1.changes[0]!;
            const change2 = entry2.changes[0]!;
            return (
                change1.actionTime[0] - change2.actionTime[0] ||
                (entry1.activityEntryId < entry2.activityEntryId ? -1 : 1)
            );
        });
}

test("scalar updates project one persistent discrete entry each", async () => {
    const actionContext = context.action(session);
    const taskId = await createTask();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await processEntryGroup({
        taskId,
        activityTime: firstActivityTime,
        changes: [
            {type: "TaskStatusUpdated", previousStatusType: "OpenActive", statusType: "Closed"},
        ],
    });
    // Reverses the first update. Discrete entries persist; read-time aggregation
    // decides what renders.
    await processEntryGroup({
        taskId,
        activityTime: addMinutes(firstActivityTime, 1),
        changes: [
            {type: "TaskStatusUpdated", previousStatusType: "Closed", statusType: "OpenActive"},
        ],
    });

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortEntryModels(entriesResult.items).flatMap(model => model.changes)).toMatchObject([
        {type: "TaskStatusUpdated", previousStatusType: "OpenActive", statusType: "Closed"},
        {type: "TaskStatusUpdated", previousStatusType: "Closed", statusType: "OpenActive"},
        // The `TaskCreated` entry sorts last because the commit happened at the current
        // time while the groups above use historical times.
        {type: "TaskCreated"},
    ]);
});

test("a transaction\u2019s changes to one task project as a single entry in action order", async () => {
    const taskId = generateId<TaskId>();

    const events = await processEntryGroup({
        taskId,
        activityTime: new Date("2026-01-01T12:00:00.000Z"),
        changes: [
            {type: "TaskCreated"},
            {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
        ],
    });

    const event = events[0];
    assert(event?.type === "PutItem");
    assert(event.item.model instanceof TaskActivityFeedDiscreteEntryModel);
    expect(event.item.model.changes).toMatchObject([
        {type: "TaskCreated"},
        {type: "TaskPriorityUpdated", priority: "High"},
    ]);
});

test("processing the same group twice is idempotent", async () => {
    const group = {
        actionTransactionId: generateId<TaskActionTransactionId>(),
        taskId: generateId<TaskId>(),
        activityTime: new Date("2026-01-01T12:00:00.000Z"),
        changes: [{type: "TaskCreated"}],
    } as const;

    const firstEvents = await processEntryGroup(group);
    const replayEvents = await processEntryGroup(group);

    expect({firstEvents, replayEvents}).toMatchObject({
        firstEvents: [{type: "PutItem"}],
        replayEvents: [],
    });
});

test("processors racing on one source create exactly one entry and marker", async () => {
    const taskId = generateId<TaskId>();
    const actionTransactionId = generateId<TaskActionTransactionId>();
    const idempotencyKey = `${actionTransactionId}:${taskId}` as const;
    const activityTime1 = new Date("2026-01-01T12:00:00.000Z");
    const activityTime2 = new Date("2026-01-01T12:00:01.000Z");
    const pausePromise1 =
        processTaskActivityEntryGroupsBeforeTransactionTestCheckpoint.pauseForTest({
            idempotencyKey,
            firstActionTime: [activityTime1.getTime(), 0],
        });
    const pausePromise2 =
        processTaskActivityEntryGroupsBeforeTransactionTestCheckpoint.pauseForTest({
            idempotencyKey,
            firstActionTime: [activityTime2.getTime(), 0],
        });

    const processPromise1 = processEntryGroup({
        actionTransactionId,
        taskId,
        activityTime: activityTime1,
        changes: [{type: "TaskCreated"}],
    });
    const processPromise2 = processEntryGroup({
        actionTransactionId,
        taskId,
        activityTime: activityTime2,
        changes: [{type: "TaskCreated"}],
    });
    const [pause1, pause2] = await runAllPromises([pausePromise1, pausePromise2]);
    pause1.unpause();
    pause2.unpause();

    const [events1, events2] = await runAllPromises([processPromise1, processPromise2]);
    const marker = await TaskActivityTable.getItem(
        context.action(session),
        {
            partitionType: "ProcessedSource",
            sortRangeType: "Marker",
            idempotencyKey,
        },
        {consistency: "Strong"},
    );
    const entries = await TaskActivityTable.realtimeQuery(context.action(session), {
        partitionKey: {partitionType: "Task", spaceId: space.id, taskId},
        startSortKey: {
            sortRangeType: "ActivityEntry",
            activityEntryId: getMinId<TaskActivityEntryId>(),
        },
        endSortKey: {
            sortRangeType: "ActivityEntry",
            activityEntryId: getMaxId<TaskActivityEntryId>(),
        },
        limit: "All",
    });

    expect({
        eventCounts: [events1.length, events2.length].sort(),
        entryCount: entries.items.length,
        marker: {
            idempotencyKey: marker.idempotencyKey,
            spaceId: marker.spaceId,
            taskId: marker.taskId,
        },
    }).toEqual({
        eventCounts: [0, 1],
        entryCount: 1,
        marker: {idempotencyKey, spaceId: space.id, taskId},
    });
});

test("a group with no changes writes only its marker and suppresses replays", async () => {
    const taskId = generateId<TaskId>();
    const actionTransactionId = generateId<TaskActionTransactionId>();
    const activityTime = new Date("2026-01-01T12:00:00.000Z");

    // A transaction whose actions all lost their merges: evaluated, no entry.
    await processEntryGroup({actionTransactionId, taskId, activityTime, changes: []});

    // A crash-recovery replay of the same group falls back to emitting with unknown
    // before values — the marker must suppress it.
    const replayEvents = await processEntryGroup({
        actionTransactionId,
        taskId,
        activityTime,
        changes: [{type: "TaskPriorityUpdated", priority: "High"}],
    });

    expect(replayEvents).toEqual([]);
});
