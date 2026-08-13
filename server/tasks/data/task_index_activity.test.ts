import {CalendarDate} from "@internationalized/date";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {getTaskActivityEntries} from "~/server/tasks/data/get_task_activity_entries.js";
import {
    TaskActivityEntryChange,
    TaskActivityTable,
} from "~/server/tasks/data/internal/task_activity_table.js";
import {
    emitTaskActivityBeforeProjectionTestCheckpoint,
    indexTaskActionTransactionAssumingItsCommittedForTest,
    indexTaskActionTransactionBeforeWriteTestCheckpoint,
} from "~/server/tasks/data/task_index.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId, getMinId} from "~/shared/id/id.open_source.js";
import {TaskActionTransactionId, TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {CalendarDateSchema} from "~/shared/tasks/calendar_date_schema.js";
import {
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityFeedWindowChunkModel,
} from "~/shared/tasks/task_activity.js";
import {decodeTaskActivityWindows} from "~/shared/tasks/task_activity_window_chunk.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";
import {
    TaskTitleModel,
    TaskTitleUpdate,
    applyTaskTitleUpdate,
    createTaskTitleFromText,
    createTaskTitleRetypeUpdateForTest,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

// Task activity is emitted while indexing action transactions into the OpenSearch
// task index (see `TaskActionTransactionIndexState`), so these end-to-end tests
// enable OpenSearch: committing an action transaction exercises the full commit →
// index → activity pipeline.
const context = createTestContext({
    shouldStartOpensearch: true,
    spacesInjection,
    tasksInjection,
});
const space = createTestSpace(context);
const session = createTestSession(context, space);
const aliceSession = createTestSession(context, space);
const bobSession = createTestSession(context, space);
const actor = {accountId: session.accountId, from: null} as const;

function createTaskAction(taskId: TaskId, timeMs: number): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {
            type: "Create",
            creator: actor,
            creatorTimeZone: defaultTimeZone,
        },
    };
}

function updateStatusAction(taskId: TaskId, timeMs: number, status: TaskStatus): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {type: "UpdateStatus", status},
    };
}

function updateAssigneeAction(taskId: TaskId, timeMs: number, assigneeId: AccountId): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {
            type: "UpdateAssignee",
            assignee: {
                assigneeId,
                assignerId: session.accountId,
                assignedTime: TaskFilterableTime.test([timeMs, 0]),
            },
        },
    };
}

function deletionAction(taskId: TaskId, timeMs: number, type: "Delete" | "Undelete"): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {type},
    };
}

function dueDateAction(taskId: TaskId, timeMs: number, dueDate: CalendarDate | null): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {type: "UpdateDueDate", dueDate},
    };
}

function updateTitleAction(
    taskId: TaskId,
    timeMs: number,
    titleUpdate: TaskTitleUpdate,
): TaskAction {
    return {
        type: "UpdateTask",
        time: [timeMs, 0],
        taskId,
        taskAction: {type: "UpdateTitle", titleUpdate},
    };
}

function closedStatus(timeMs: number): TaskStatus {
    return {
        type: "Closed",
        closerId: session.accountId,
        closedTime: new TaskFilterableTime({
            absoluteTime: [timeMs, 0],
            setterTimeZone: defaultTimeZone,
        }),
    };
}

// Entries come back in projection order and may group actions whose logical times
// interleave with other entries. Flatten before sorting to mirror the client.
function sortKnownChanges(items: ReadonlyArray<{model: unknown}>): Array<TaskActivityEntryChange> {
    return items
        .flatMap(item => {
            const model = item.model;
            if (!(model instanceof TaskActivityFeedDiscreteEntryModel)) return [];

            return model.changes.map((change, changeIndex) => ({
                activityEntryId: model.activityEntryId,
                changeIndex,
                change,
            }));
        })
        .sort((source1, source2) => {
            const timeComparison = compareHybridLogicalTimes(
                source1.change.actionTime,
                source2.change.actionTime,
            );
            if (timeComparison !== 0) return timeComparison;
            if (source1.activityEntryId < source2.activityEntryId) return -1;
            if (source1.activityEntryId > source2.activityEntryId) return 1;
            return source1.changeIndex - source2.changeIndex;
        })
        .map(source => {
            const change = source.change;
            if (change.type !== "TaskAssigneeUpdated") return change;

            return {
                type: change.type,
                actionTime: change.actionTime,
                previousAssigneeId:
                    change.previousAssignee === undefined
                        ? undefined
                        : (change.previousAssignee?.id ?? null),
                assigneeId: change.assignee?.id ?? null,
            };
        });
}

function getFirstTaskActivityActorAccount(items: ReadonlyArray<{model: unknown}>) {
    for (const {model} of items) {
        if (model instanceof TaskActivityFeedDiscreteEntryModel && model.actor !== null) {
            return model.actor.account;
        }
        if (model instanceof TaskActivityFeedWindowChunkModel && model.actors[0] !== undefined) {
            return model.actors[0].account;
        }
    }
    return undefined;
}

// Reads a task's client-visible activity through the internal table, for tests
// whose task can't authorize a read (deleted, or never committed).
async function queryTaskActivityEntryItems(
    actionContext: Parameters<typeof TaskActivityTable.realtimeQuery>[0],
    taskId: TaskId,
) {
    return await TaskActivityTable.realtimeQuery(actionContext, {
        partitionKey: {partitionType: "Task", spaceId: space.id, taskId},
        startSortKey: {
            sortRangeType: "ActivityEntry",
            activityEntryId: getMinId<TaskActivityEntryId>(),
        },
        endSortKey: {
            sortRangeType: "TitleWindowChunks",
            chunkNumber: Number.MAX_SAFE_INTEGER,
        },
        limit: 100,
    });
}

function decodeTitleWindows(items: ReadonlyArray<{model: unknown}>) {
    return items
        .map(item => item.model)
        .filter(model => model instanceof TaskActivityFeedWindowChunkModel)
        .filter(model => model.contentField === "Title")
        .flatMap(model => decodeTaskActivityWindows(model));
}

test("committing a status update projects a discrete entry with its before value", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 1, closedStatus(currentTime + 1)),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items)).toMatchObject([
        {type: "TaskCreated"},
        {
            type: "TaskStatusUpdated",
            previousStatusType: "OpenInactive",
            statusType: "Closed",
        },
    ]);
});

test("a reversed status update keeps both discrete entries", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 1, closedStatus(currentTime + 1)),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 2, {type: "Open"}),
    ]);
    await ProcessContextModule.waitForTestTasks();

    // Both updates persist as raw entries. Hiding the reversed pair is read-time
    // aggregation's job (`deriveTaskActivityFeed()`).
    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items).map(change => change.type)).toEqual([
        "TaskCreated",
        "TaskStatusUpdated",
        "TaskStatusUpdated",
    ]);
});

test("a noop status update produces no activity", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    // The task is already open, so this update doesn't change the effective status.
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 1, {type: "Open"}),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items).map(change => change.type)).toEqual([
        "TaskCreated",
    ]);
});

test("deleting a task projects a deletion entry with its before value", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        deletionAction(taskId, currentTime + 1, "Delete"),
    ]);
    await ProcessContextModule.waitForTestTasks();

    // Query the internal index directly since the task itself is now deleted.
    const entriesResult = await queryTaskActivityEntryItems(actionContext, taskId);

    expect(sortKnownChanges(entriesResult.items)).toMatchObject([
        {type: "TaskCreated"},
        {
            type: "TaskDeletionUpdated",
            previousIsDeleted: false,
            isDeleted: true,
        },
    ]);
});

test("setting then clearing a due date keeps both discrete entries", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        dueDateAction(taskId, currentTime + 1, CalendarDateSchema.deserialize("2026-08-01")),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        dueDateAction(taskId, currentTime + 2, null),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items).map(change => change.type)).toEqual([
        "TaskCreated",
        "TaskDueDateUpdated",
        "TaskDueDateUpdated",
    ]);
});

test("an action that loses the register merge records its intended value", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        dueDateAction(taskId, currentTime + 3, CalendarDateSchema.deserialize("2026-08-01")),
    ]);
    // The due date update was committed later but has an older action time, so the
    // last-writer-wins register keeps the first due date. Activity is best effort: the
    // losing action records its intended value without claiming a before value.
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 2, closedStatus(currentTime + 2)),
        dueDateAction(taskId, currentTime + 1, CalendarDateSchema.deserialize("2026-09-15")),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items)).toMatchObject([
        {type: "TaskCreated"},
        {type: "TaskDueDateUpdated", dueDate: {day: 15, month: 9}},
        {type: "TaskStatusUpdated"},
        {type: "TaskDueDateUpdated", previousDueDate: null, dueDate: {day: 1, month: 8}},
    ]);
});

test("same-transaction assignee updates retain the action times that determine the winner", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    const winningTime = currentTime + 2;
    const losingTime = currentTime + 1;

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    // Deliberately put the winning action first. Array order would make Bob look
    // latest, but the assignee register retains Alice because her action has the
    // greater hybrid logical time.
    await commitTaskActionTransaction(actionContext, space.id, [
        updateAssigneeAction(taskId, winningTime, aliceSession.accountId),
        updateAssigneeAction(taskId, losingTime, bobSession.accountId),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });
    const assigneeChanges = entriesResult.items
        .map(item => item.model)
        .filter(model => model instanceof TaskActivityFeedDiscreteEntryModel)
        .flatMap(model => model.changes)
        .filter(change => change.type === "TaskAssigneeUpdated");

    expect(assigneeChanges).toEqual([
        {
            type: "TaskAssigneeUpdated",
            actionTime: [winningTime, 0],
            previousAssignee: null,
            assignee: expect.objectContaining({id: aliceSession.accountId}),
        },
        {
            type: "TaskAssigneeUpdated",
            actionTime: [losingTime, 0],
            previousAssignee: undefined,
            assignee: expect.objectContaining({id: bobSession.accountId}),
        },
    ]);
});

test("a transaction whose only action loses the register merge emits a fallback entry", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        dueDateAction(taskId, currentTime + 2, CalendarDateSchema.deserialize("2026-08-01")),
    ]);
    // The losing transaction applies to the index as a complete noop and still emits a
    // fallback entry — a deliberate fail-open, see the `Noop` doc on
    // `TaskActivityCandidateResult`.
    await commitTaskActionTransaction(actionContext, space.id, [
        dueDateAction(taskId, currentTime + 1, CalendarDateSchema.deserialize("2026-09-15")),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(sortKnownChanges(entriesResult.items)).toMatchObject([
        {type: "TaskCreated"},
        // The fallback carries the action's intended value and no initial value.
        {
            type: "TaskDueDateUpdated",
            dueDate: {day: 15, month: 9},
        },
        {type: "TaskDueDateUpdated", previousDueDate: null},
    ]);
});

test("a losing close still reports the task as closed", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 2, closedStatus(currentTime + 2)),
    ]);
    // Applies as a display-status noop (Closed → Closed), but a close's intended
    // display value is derivable from the action alone — a Closed status register
    // determines a Closed display status — so it emits without an initial value (see
    // the noop policy on `getTaskActivityUpdateFromTaskIndexDocs()`).
    await commitTaskActionTransaction(actionContext, space.id, [
        updateStatusAction(taskId, currentTime + 1, closedStatus(currentTime + 1)),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {taskId});
    const statusChanges = sortKnownChanges(entriesResult.items).filter(
        change => change.type === "TaskStatusUpdated",
    );

    expect(statusChanges).toEqual([
        {type: "TaskStatusUpdated", actionTime: [currentTime + 1, 0], statusType: "Closed"},
        {
            type: "TaskStatusUpdated",
            actionTime: [currentTime + 2, 0],
            previousStatusType: "OpenInactive",
            statusType: "Closed",
        },
    ]);
});

test("re-indexing the same transaction projects activity exactly once", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    const actions = [
        createTaskAction(taskId, currentTime),
        updateStatusAction(taskId, currentTime + 1, closedStatus(currentTime + 1)),
    ];
    const activityActionTransaction = {
        context: systemContext,
        actionTransactionId: generateId<TaskActionTransactionId>(),
    };

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {activityActionTransaction},
    );
    // Simulate the `wasProcessed` sweeper retrying a transaction that was fully
    // indexed and emitted but crashed before being marked processed. The replay
    // applies as a noop and source markers deduplicate the emission.
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {activityActionTransaction},
    );
    await ProcessContextModule.waitForTestTasks();

    const entriesResult = await queryTaskActivityEntryItems(systemContext, taskId);

    expect(sortKnownChanges(entriesResult.items).map(change => change.type)).toEqual([
        "TaskCreated",
        "TaskStatusUpdated",
    ]);
});

test("recovering a transaction drops an ambiguous status fallback", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    // An OPEN status update: its recovery is ambiguous because a noop can't recover
    // whether the intent was OpenActive or OpenInactive (noop policy caveat 3 on
    // `getTaskActivityUpdateFromTaskIndexDocs()`). A close would emit — a Closed
    // status register alone determines the display status.
    const actions = [
        createTaskAction(taskId, currentTime),
        updateStatusAction(taskId, currentTime + 1, {type: "Open"}),
    ];

    // Index without emitting activity, simulating an attempt that wrote the index docs
    // but crashed before emission left any source markers. This happens for real: the
    // `wasProcessed` flip lands strictly AFTER indexing + emission complete (see
    // `processTaskActionTransaction`), so a process that dies after the OpenSearch
    // bulk write but before emission — or before the flip — leaves
    // `wasProcessed: false` and the maintenance sweeper re-runs the whole pipeline
    // ~12s later. That re-run applies to the index as a total noop (the docs already
    // absorbed the actions) and finds no source markers. The same shape occurs when
    // the account-name recheck re-runs an attempt.
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
    );
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );
    await ProcessContextModule.waitForTestTasks();

    // Creation intent is unambiguous, but the open status action no longer has enough
    // context to recover its intended display status reliably.
    const entriesResult = await queryTaskActivityEntryItems(systemContext, taskId);

    expect(sortKnownChanges(entriesResult.items)).toMatchObject([{type: "TaskCreated"}]);
});

test("renaming a task projects a title window with log versions and texts", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(
            taskId,
            currentTime + 1,
            createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "Fix login flow"),
        ),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect({
        entries: sortKnownChanges(entriesResult.items),
        titleWindows: decodeTitleWindows(entriesResult.items),
    }).toMatchObject({
        entries: [{type: "TaskCreated"}],
        titleWindows: [{fromVersion: 0, toVersion: 1, wasReverted: false}],
    });
});

test("independent activity projections in one transaction overlap", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const currentTime = Date.now();

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [createTaskAction(taskId1, currentTime), createTaskAction(taskId2, currentTime)],
    );

    const projectionPausePromises = [
        emitTaskActivityBeforeProjectionTestCheckpoint.pauseForTest("Discrete"),
        emitTaskActivityBeforeProjectionTestCheckpoint.pauseForTest(taskId1),
        emitTaskActivityBeforeProjectionTestCheckpoint.pauseForTest(taskId2),
    ];
    const indexingPromise = indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [
            updateTitleAction(
                taskId1,
                currentTime + 1,
                createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "First task"),
            ),
            dueDateAction(taskId1, currentTime + 2, CalendarDateSchema.deserialize("2026-08-01")),
            updateTitleAction(
                taskId2,
                currentTime + 3,
                createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "Second task"),
            ),
        ],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );

    // Resolving all three pause promises proves the discrete projection and both
    // task-partitioned window projections started before any one of them completed.
    const projectionPauses = await runAllPromises(projectionPausePromises);
    for (const projectionPause of projectionPauses) projectionPause.unpause();
    await indexingPromise;

    const [task1EntriesResult, task2EntriesResult] = await runAllPromises([
        queryTaskActivityEntryItems(systemContext, taskId1),
        queryTaskActivityEntryItems(systemContext, taskId2),
    ]);

    expect({
        task1Changes: sortKnownChanges(task1EntriesResult.items),
        task1TitleWindows: decodeTitleWindows(task1EntriesResult.items),
        task2Changes: sortKnownChanges(task2EntriesResult.items),
        task2TitleWindows: decodeTitleWindows(task2EntriesResult.items),
    }).toMatchObject({
        task1Changes: [{type: "TaskDueDateUpdated"}],
        task1TitleWindows: [{fromVersion: 0, toVersion: 1}],
        task2Changes: [],
        task2TitleWindows: [{fromVersion: 0, toVersion: 1}],
    });
});

test("a second rename within the window absorbs into the title window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    // Successive updates from one editing session (see `wordTaskTitleTestScenario`):
    // "" -> "h" then "h" -> "he".
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(taskId, currentTime + 1, wordTaskTitleTestScenario.update0),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(taskId, currentTime + 2, wordTaskTitleTestScenario.update1),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect({
        entries: sortKnownChanges(entriesResult.items),
        titleWindows: decodeTitleWindows(entriesResult.items),
    }).toMatchObject({
        entries: [{type: "TaskCreated"}],
        titleWindows: [{fromVersion: 0, toVersion: 2, wasReverted: false}],
    });
});

test("recovering a replayed title update projects no window", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    const actions = [
        createTaskAction(taskId, currentTime),
        updateTitleAction(taskId, currentTime + 1, wordTaskTitleTestScenario.update0),
    ];
    const activityActionTransaction = {
        context: systemContext,
        actionTransactionId: generateId<TaskActionTransactionId>(),
    };

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
    );
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {activityActionTransaction},
    );
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {activityActionTransaction},
    );

    const entriesResult = await queryTaskActivityEntryItems(systemContext, taskId);

    // Both emitting runs replay the title update as an identity noop, and title noops
    // never emit (noop policy caveat 2 on `getTaskActivityUpdateFromTaskIndexDocs()`):
    // the intended text can't be derived from the action's Yjs state alone. A title
    // update whose first attempt crashed before emitting is accepted as lost rather
    // than projecting an unattributable window.
    expect(decodeTitleWindows(entriesResult.items)).toEqual([]);
});

test("a title update with no visible effect produces no title window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    const titleClientId = randomlyGenerateTaskTitleClientId();
    const invisibleUpdate = TaskTitleModel.fromText(titleClientId, "").replaceMany(titleClientId, [
        {from: 0, to: 0, text: "x"},
        {from: 0, to: 1, text: ""},
    ]);

    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(taskId, currentTime + 1, invisibleUpdate.raw),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    expect(decodeTitleWindows(entriesResult.items)).toEqual([]);
});

test("activity actors remain available after they are removed from the space", async () => {
    const activitySpace = await TestSpace.create(context);
    const [creatorSession, viewerSession] = await activitySpace.createSessions(2);
    const task = await TestTask.create(creatorSession);
    await task.access.grant(creatorSession, viewerSession, "View");
    await ProcessContextModule.waitForTestTasks();

    await activitySpace.removeAccount(creatorSession);

    const {entriesResult} = await getTaskActivityEntries(viewerSession.action(), {
        taskId: task.id,
    });
    const actorAccount = getFirstTaskActivityActorAccount(entriesResult.items);

    expect(actorAccount?.initialData).toEqual(
        expect.objectContaining({
            id: creatorSession.account.id,
            space: expect.objectContaining({state: expect.objectContaining({type: "Removed"})}),
        }),
    );
});

test("task URL grants receive account stubs instead of full space account models", async () => {
    const urlSpace = await TestSpace.create(context);
    const creatorSession = await urlSpace.createSession();
    const otherSpace = await TestSpace.create(context);
    const outsiderSession = await otherSpace.createSession();
    const task = await TestTask.create(creatorSession);
    await task.access.grantUrl(creatorSession);
    await ProcessContextModule.waitForTestTasks();

    const [anonymousResult, signedInResult, memberResult] = await runAllPromises([
        getTaskActivityEntries(context.anonymousAction(), {
            taskId: task.id,
        }),
        getTaskActivityEntries(outsiderSession.action(), {
            taskId: task.id,
        }),
        getTaskActivityEntries(creatorSession.action(), {
            taskId: task.id,
        }),
    ]);

    // A URL grant carries task access, NOT space access. Those viewers still get the
    // creator's name so the feed reads, but the space membership data is dummy and the
    // version is negative so a real `AccountModel` always wins when the client merges.
    for (const {entriesResult} of [anonymousResult, signedInResult]) {
        const account = getFirstTaskActivityActorAccount(entriesResult.items);
        expect(account?.initialData).toEqual(
            expect.objectContaining({
                id: creatorSession.account.id,
                name: creatorSession.account.initialName,
                space: expect.objectContaining({
                    addedTime: new Date(0),
                    role: "Member",
                }),
            }),
        );
        expect(account!.initialData.version).toBeLessThan(0);
    }

    // A viewer who does have space access gets the real model.
    const memberAccount = getFirstTaskActivityActorAccount(memberResult.entriesResult.items);
    expect(memberAccount?.initialData).toEqual(
        expect.objectContaining({
            id: creatorSession.account.id,
            name: creatorSession.account.initialName,
        }),
    );
    expect(memberAccount!.initialData.version).toBeGreaterThanOrEqual(0);
});

test("inherited task URL grants receive account stubs", async () => {
    const urlSpace = await TestSpace.create(context);
    const creatorSession = await urlSpace.createSession();
    const parentTask = await TestTask.create(creatorSession);
    const childTask = await TestTask.create(creatorSession, {parent: parentTask});
    await parentTask.access.grantUrl(creatorSession);
    await ProcessContextModule.waitForTestTasks();

    const {entriesResult} = await getTaskActivityEntries(context.anonymousAction(), {
        taskId: childTask.id,
    });

    const account = getFirstTaskActivityActorAccount(entriesResult.items);
    expect(account?.initialData).toEqual(
        expect.objectContaining({
            id: creatorSession.account.id,
            name: creatorSession.account.initialName,
            space: expect.objectContaining({addedTime: new Date(0), role: "Member"}),
        }),
    );
    expect(account!.initialData.version).toBeLessThan(0);
});

test("partial OpenSearch version conflicts retain every successful task activity", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId1 = generateId<TaskId>();
    const taskId2 = generateId<TaskId>();
    const currentTime = Date.now();
    const dueDate = CalendarDateSchema.deserialize("2026-08-15");
    await runAllPromises([
        indexTaskActionTransactionAssumingItsCommittedForTest(
            systemContext,
            space.id,
            session.accountId,
            [createTaskAction(taskId1, currentTime)],
        ),
        indexTaskActionTransactionAssumingItsCommittedForTest(
            systemContext,
            space.id,
            session.accountId,
            [createTaskAction(taskId2, currentTime)],
        ),
    ]);

    const pausePromise = indexTaskActionTransactionBeforeWriteTestCheckpoint.pauseForTest(space.id);
    let retryCount = 0;
    const indexingPromise = indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [
            dueDateAction(taskId1, currentTime + 10, dueDate),
            dueDateAction(taskId2, currentTime + 10, dueDate),
        ],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
            onRetry: () => retryCount++,
        },
    );
    const {unpause, stopPausing} = await pausePromise;
    stopPausing();

    // This writes task 2 after the multi-task attempt has read both docs. The first
    // bulk therefore succeeds for task 1 and version-conflicts for task 2.
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [updateStatusAction(taskId2, currentTime + 5, closedStatus(currentTime + 5))],
    );
    unpause();
    await indexingPromise;

    const [task1Activity, task2Activity] = await runAllPromises([
        queryTaskActivityEntryItems(systemContext, taskId1),
        queryTaskActivityEntryItems(systemContext, taskId2),
    ]);
    expect({
        retryCount,
        task1Changes: sortKnownChanges(task1Activity.items),
        task2Changes: sortKnownChanges(task2Activity.items),
    }).toMatchObject({
        retryCount: 1,
        task1Changes: [{type: "TaskDueDateUpdated", dueDate}],
        task2Changes: [{type: "TaskDueDateUpdated", dueDate}],
    });
});

test("a rename era that returns to its starting text projects a reverted window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    // Backdated so the second era's action times stay in the past — commit rejects
    // action times ahead of the server clock.
    const currentTime = Date.now() - 30 * 60 * 1000;
    const clientId = randomlyGenerateTaskTitleClientId();
    const eraGapMs = 20 * 60 * 1000;

    const initialTitle = createTaskTitleFromText(clientId, "hello");
    await commitTaskActionTransaction(actionContext, space.id, [
        createTaskAction(taskId, currentTime),
        updateTitleAction(taskId, currentTime + 1, initialTitle),
    ]);

    // A second era past the idle debounce renames away and back, so the era's window
    // starts AND ends at "hello". Revert detection crosses the whole pipeline here:
    // doc-diff capture reads the texts off the index docs, and the window engine
    // compares the era's end state against its snapshot.
    const renameUpdate = createTaskTitleRetypeUpdateForTest(initialTitle, clientId, "Hello");
    const revertUpdate = createTaskTitleRetypeUpdateForTest(
        applyTaskTitleUpdate(initialTitle, renameUpdate),
        clientId,
        "hello",
    );
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(taskId, currentTime + eraGapMs, renameUpdate),
    ]);
    await commitTaskActionTransaction(actionContext, space.id, [
        updateTitleAction(taskId, currentTime + eraGapMs + 1000, revertUpdate),
    ]);
    await ProcessContextModule.waitForTestTasks();

    const entriesResult = await queryTaskActivityEntryItems(context.systemAction(space.id), taskId);

    expect(decodeTitleWindows(entriesResult.items)).toMatchObject([
        {fromVersion: 0, toVersion: 1, wasReverted: false},
        {fromVersion: 1, toVersion: 3, wasReverted: true},
    ]);
});

test("a version conflict restarts indexing without leaking the failed attempt\u2019s activity", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [createTaskAction(taskId, currentTime)],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );

    // Pause the EARLIER close's attempt just before its OpenSearch write...
    const pausePromise = indexTaskActionTransactionBeforeWriteTestCheckpoint.pauseForTest(space.id);
    let retryCount = 0;
    const pausedIndexPromise = indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [updateStatusAction(taskId, currentTime + 1, closedStatus(currentTime + 1))],
        {
            onRetry: () => retryCount++,
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );
    const pause = await pausePromise;
    // Stop gating the checkpoint so the next indexing run (and the paused run's own
    // retry) pass through freely — only the already-paused attempt stays held.
    pause.stopPausing();
    // ...while a LATER close indexes completely, winning the doc version.
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [updateStatusAction(taskId, currentTime + 2, closedStatus(currentTime + 2))],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );
    pause.unpause();
    await pausedIndexPromise;
    await ProcessContextModule.waitForTestTasks();

    // The stale attempt conflicted and restarted with fresh state. Its first attempt
    // had computed an effective Open\u2192Closed transition; the retry re-applied
    // against the later close's doc as a register merge loser, so what emitted is the
    // no-initial Closed fallback \u2014 the failed attempt's transition never leaked.
    const entriesResult = await queryTaskActivityEntryItems(systemContext, taskId);
    const statusChanges = sortKnownChanges(entriesResult.items).filter(
        change => change.type === "TaskStatusUpdated",
    );
    expect({retryCount, statusChanges}).toEqual({
        retryCount: 1,
        statusChanges: [
            {type: "TaskStatusUpdated", actionTime: [currentTime + 1, 0], statusType: "Closed"},
            {
                type: "TaskStatusUpdated",
                actionTime: [currentTime + 2, 0],
                previousStatusType: "OpenInactive",
                statusType: "Closed",
            },
        ],
    });
}, 30000);

test("an exhausted indexing attempt emits nothing until a replay converges", async () => {
    const systemContext = context.systemAction(space.id);
    const taskId = generateId<TaskId>();
    const currentTime = Date.now();
    const actions = [
        dueDateAction(taskId, currentTime + 1, CalendarDateSchema.deserialize("2026-08-01")),
    ];
    const activityActionTransaction = {
        context: systemContext,
        actionTransactionId: generateId<TaskActionTransactionId>(),
    };

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [createTaskAction(taskId, currentTime)],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );

    // A concurrent write conflicts the due date attempt, and with a single allowed
    // attempt the version conflict is terminal for this run.
    const pausePromise = indexTaskActionTransactionBeforeWriteTestCheckpoint.pauseForTest(space.id);
    const pausedIndexPromise = indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {maxRetryAttemptCount: 1, activityActionTransaction},
    );
    const pause = await pausePromise;
    // See the retry test above: without this the next run deadlocks on the gate.
    pause.stopPausing();
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        [updateAssigneeAction(taskId, currentTime + 2, aliceSession.accountId)],
        {
            activityActionTransaction: {
                context: systemContext,
                actionTransactionId: generateId<TaskActionTransactionId>(),
            },
        },
    );
    pause.unpause();
    await expect(pausedIndexPromise).rejects.toThrow();
    await ProcessContextModule.waitForTestTasks();

    const changeTypesAfterFailure = sortKnownChanges(
        (await queryTaskActivityEntryItems(systemContext, taskId)).items,
    ).map(change => change.type);

    // The sweeper analog: re-running the transaction (same activity transaction id)
    // applies the due date and emits it exactly once \u2014 markers deduplicate, they
    // don't block the recovery.
    await indexTaskActionTransactionAssumingItsCommittedForTest(
        systemContext,
        space.id,
        session.accountId,
        actions,
        {activityActionTransaction},
    );
    await ProcessContextModule.waitForTestTasks();
    const changeTypesAfterReplay = sortKnownChanges(
        (await queryTaskActivityEntryItems(systemContext, taskId)).items,
    ).map(change => change.type);

    expect({changeTypesAfterFailure, changeTypesAfterReplay}).toEqual({
        changeTypesAfterFailure: ["TaskCreated", "TaskAssigneeUpdated"],
        changeTypesAfterReplay: ["TaskCreated", "TaskDueDateUpdated", "TaskAssigneeUpdated"],
    });
}, 30000);

// TODO(#task-activity-generative-tests): Random action sequences with random
// crash/replay points, checked against a sequential in-memory oracle, are the
// right tool for the marker/fallback/window permutation space unit tests can't
// enumerate. Deliberately deferred until the activity model settles.
