import {addMinutes} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {
    backfillTaskActivity,
    getTaskActivityEntries,
} from "~/server/tasks/data/get_task_activity_entries.js";
import {
    TaskActivityWindowUpdate,
    applyTaskActivityWindowUpdate,
    applyTaskActivityWindowUpdateAfterReadTestCheckpoint,
} from "~/server/tasks/data/internal/apply_task_activity_window_update.js";
import {processTaskActivityEntriesByTaskId} from "~/server/tasks/data/internal/process_task_activity_entries_by_task_id.js";
import {
    TaskActivityEntryChange,
    TaskActivityTable,
} from "~/server/tasks/data/internal/task_activity_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TaskActionTransactionId} from "~/shared/id/types/id_types.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityFeedWindowChunkModel,
    TaskActivityModel,
} from "~/shared/tasks/task_activity.js";
import {
    decodeTaskActivityWindows,
    encodeTaskActivityWindows,
    getTaskActivityWindowChunkByteLength,
    taskActivityWindowChunkMaxByteLength,
    taskActivityWindowFormatVersion,
} from "~/shared/tasks/task_activity_window_chunk.js";
import {generateServerSynchronizationCheckpointForTest} from "~/shared/web_socket/server_synchronization_checkpoint.js";

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
    await processTaskActivityEntriesByTaskId(
        context.action(session),
        space.id,
        actor,
        generateId<TaskActionTransactionId>(),
        new Map<TaskId, ReadonlyArray<TaskActivityEntryChange>>([
            [taskId, [{type: "TaskCreated", actionTime: [currentTime, 0]}]],
        ]),
    );

    return taskId;
}

function notesUpdate({
    activityTime,
    startVersion,
    endVersion,
    beforeContentHash,
    afterContentHash,
    updateActor = actor,
}: {
    activityTime: Date;
    startVersion: number;
    endVersion: number;
    beforeContentHash: string;
    afterContentHash: string;
    updateActor?: {accountId: AccountId; from: null};
}): TaskActivityWindowUpdate {
    return {
        actor: updateActor,
        activityTime,
        fromVersion: startVersion,
        toVersion: endVersion,
        content: {type: "Notes", beforeContentHash, afterContentHash},
    };
}

function titleUpdate({
    activityTime,
    startVersion,
    endVersion,
    beforeTitleText,
    afterTitleText,
}: {
    activityTime: Date;
    startVersion: number;
    endVersion: number;
    beforeTitleText: string | null;
    afterTitleText: string | null;
}): TaskActivityWindowUpdate {
    return {
        actor,
        activityTime,
        fromVersion: startVersion,
        toVersion: endVersion,
        content: {type: "Title", beforeTitleText, afterTitleText},
    };
}

async function createTitleWindowsAroundBackfillGap(
    actionContext: Parameters<typeof applyTaskActivityWindowUpdate>[0],
    taskId: TaskId,
) {
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");
    const windowUpdates = [
        {activityMinute: 0, startVersion: 0, endVersion: 1},
        {activityMinute: 2, startVersion: 1, endVersion: 2},
        {activityMinute: 4, startVersion: 2, endVersion: 4},
        {activityMinute: 7, startVersion: 8, endVersion: 9},
        {activityMinute: 9, startVersion: 9, endVersion: 10},
        {activityMinute: 10, startVersion: 10, endVersion: 12},
    ];

    for (const windowUpdate of windowUpdates) {
        await applyTaskActivityWindowUpdate(actionContext, {
            spaceId: space.id,
            taskId,
            update: titleUpdate({
                activityTime: addMinutes(firstActivityTime, windowUpdate.activityMinute),
                startVersion: windowUpdate.startVersion,
                endVersion: windowUpdate.endVersion,
                beforeTitleText: `v${windowUpdate.startVersion}`,
                afterTitleText: `v${windowUpdate.endVersion}`,
            }),
        });
    }

    expect(await queryTaskActivityWindows(actionContext, taskId, "Title")).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: addMinutes(firstActivityTime, 4),
                fromVersion: 0,
                toVersion: 4,
            },
            {
                firstActivityTime: addMinutes(firstActivityTime, 7),
                lastActivityTime: addMinutes(firstActivityTime, 10),
                fromVersion: 8,
                toVersion: 12,
            },
        ],
    });

    return firstActivityTime;
}

// Reads a field's windows straight from its chunk items — applies return nothing,
// so tests assert on the stored projection.
async function queryTaskActivityWindows(
    actionContext: Parameters<typeof TaskActivityTable.query>[0],
    taskId: TaskId,
    contentField: "Title" | "Notes" = "Notes",
) {
    const sortRangeType = contentField === "Title" ? "TitleWindowChunks" : "NotesWindowChunks";
    const items = TaskActivityTable.query(actionContext, {
        partitionKey: {partitionType: "Task", spaceId: space.id, taskId},
        startSortKey: {sortRangeType, chunkNumber: 1},
        endSortKey: {sortRangeType, chunkNumber: Number.MAX_SAFE_INTEGER},
        limit: 100,
    });

    const chunks = [];
    for await (const item of items) chunks.push(item);
    return {
        chunks,
        chunkCount: chunks.length,
        windows: chunks.flatMap(chunk => decodeTaskActivityWindows(chunk)),
    };
}

function decodeChunkEvent(event: RynamoEvent<TaskActivityModel> | null) {
    assert(event?.type === "PutItem");
    const model = event.item.model;
    assert(model instanceof TaskActivityFeedWindowChunkModel);
    return decodeTaskActivityWindows(model);
}

test("notes updates in one window absorb into a single entry", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 5),
            startVersion: 4,
            endVersion: 9,
            beforeContentHash: "draft",
            afterContentHash: "final",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        chunkCount: 1,
        windows: [{fromVersion: 0, toVersion: 9, wasReverted: false}],
    });
});

test("a notes window that returns to its initial content is marked reverted", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "original",
            afterContentHash: "edited",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 2),
            startVersion: 4,
            endVersion: 8,
            beforeContentHash: "edited",
            afterContentHash: "original",
        }),
    });

    const {windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect(windows.at(-1)).toMatchObject({wasReverted: true});
});

test("notes windows absorb out-of-order deliveries by version", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    // The later batch's job is delivered first; versions — not delivery order — set
    // the window's boundaries, and the late-arriving earlier batch moves the window's
    // start (rewriting its snapshot's start state).
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 5),
            startVersion: 4,
            endVersion: 9,
            beforeContentHash: "draft",
            afterContentHash: "final",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });

    const {windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect(windows.at(-1)).toMatchObject({
        firstActivityTime,
        fromVersion: 0,
        toVersion: 9,
    });
});

test("a notes update past the idle window starts a new entry", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    // 11 minutes of idle time exceeds the 10 minute continuous window.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 11),
            startVersion: 4,
            endVersion: 9,
            beforeContentHash: "draft",
            afterContentHash: "final",
        }),
    });

    const {windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect({
        windowCount: windows.length,
        sameWindow: windows.at(-1)!.activityEntryId === windows[0]!.activityEntryId,
    }).toEqual({windowCount: 2, sameWindow: false});
});

test("an out-of-order update near a window\u2019s edge extends that window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");
    const gapActivityTime = addMinutes(firstActivityTime, 5);
    const laterActivityTime = addMinutes(firstActivityTime, 30);

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: laterActivityTime,
            startVersion: 8,
            endVersion: 12,
            beforeContentHash: "almost-final",
            afterContentHash: "final",
        }),
    });
    // Delivered out of order into the gap, within one idle-debounce of the first
    // window's end: placement rule 4 absorbs it there, moving the edge.
    await applyTaskActivityWindowUpdate(actionContext, {
        taskId,
        spaceId: space.id,
        update: notesUpdate({
            activityTime: gapActivityTime,
            startVersion: 4,
            endVersion: 8,
            beforeContentHash: "draft",
            afterContentHash: "almost-final",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: gapActivityTime,
                fromVersion: 0,
                toVersion: 8,
            },
            {firstActivityTime: laterActivityTime, fromVersion: 8, toVersion: 12},
        ],
    });
});

test("a far out-of-order update becomes its own window in time order", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");
    const gapActivityTime = addMinutes(firstActivityTime, 25);
    const laterActivityTime = addMinutes(firstActivityTime, 60);

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: laterActivityTime,
            startVersion: 8,
            endVersion: 12,
            beforeContentHash: "almost-final",
            afterContentHash: "final",
        }),
    });
    // Delivered out of order into the gap, beyond one idle-debounce of any edge:
    // placement rule 4 inserts it as its own window at its sorted position.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: gapActivityTime,
            startVersion: 4,
            endVersion: 8,
            beforeContentHash: "draft",
            afterContentHash: "almost-final",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        windows: [
            {firstActivityTime, lastActivityTime: firstActivityTime},
            {
                firstActivityTime: gapActivityTime,
                lastActivityTime: gapActivityTime,
                fromVersion: 4,
                toVersion: 8,
            },
            {firstActivityTime: laterActivityTime, fromVersion: 8, toVersion: 12},
        ],
    });
});

test("windows accumulate each contributing actor once", async () => {
    const otherAccount = await TestAccount.create(context);
    await addSpaceAccountForTest(context, {
        spaceId: space.id,
        accountId: otherAccount.id,
    });
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        taskId,
        spaceId: space.id,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 2,
            beforeContentHash: "a",
            afterContentHash: "b",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 1),
            startVersion: 2,
            endVersion: 4,
            beforeContentHash: "b",
            afterContentHash: "c",
            updateActor: {accountId: otherAccount.id, from: null},
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 2),
            startVersion: 4,
            endVersion: 6,
            beforeContentHash: "c",
            afterContentHash: "d",
        }),
    });

    const {windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect(windows.at(-1)!.actors.map(windowActor => windowActor?.accountId)).toEqual([
        session.accountId,
        otherAccount.id,
    ]);
});

test("a redelivered notes update is dropped by version coverage", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const update = notesUpdate({
        activityTime: new Date("2026-01-01T12:00:00.000Z"),
        startVersion: 0,
        endVersion: 4,
        beforeContentHash: "empty",
        afterContentHash: "draft",
    });

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update,
    });
    // SQS redelivers the already-absorbed step transaction: its version range is
    // covered by the window it produced, so nothing changes.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update,
    });

    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        chunkCount: 1,
        windows: [{fromVersion: 0, toVersion: 4}],
    });
});

test("title windows track reverted renames", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        taskId,
        spaceId: space.id,
        update: {
            actor,
            activityTime: firstActivityTime,
            fromVersion: 1,
            toVersion: 2,
            content: {
                type: "Title",
                beforeTitleText: "Fix login bug",
                afterTitleText: "Fix login flow",
            },
        },
    });
    const revertUpdate: TaskActivityWindowUpdate = {
        actor,
        activityTime: addMinutes(firstActivityTime, 1),
        fromVersion: 2,
        toVersion: 3,
        content: {
            type: "Title",
            beforeTitleText: "Fix login flow",
            afterTitleText: "Fix login bug",
        },
    };
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: revertUpdate,
    });

    // The window texts live in the internal window snapshot item; the chunk keeps only
    // the version range and the revert flag computed from the snapshot's start state.
    const {windows} = await queryTaskActivityWindows(actionContext, taskId, "Title");
    expect(windows.at(-1)).toMatchObject({
        fromVersion: 1,
        toVersion: 3,
        wasReverted: true,
    });
});

test("a reset title version starts a new window epoch", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");
    const resetActivityTime = addMinutes(firstActivityTime, 1);
    const continuedActivityTime = addMinutes(firstActivityTime, 2);

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 5,
            beforeTitleText: null,
            afterTitleText: "Before rollback",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: resetActivityTime,
            startVersion: 0,
            endVersion: 1,
            beforeTitleText: "Before rollback",
            afterTitleText: "After rollback",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: continuedActivityTime,
            startVersion: 1,
            endVersion: 2,
            beforeTitleText: "After rollback",
            afterTitleText: "After roll-forward",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId, "Title")).toMatchObject({
        chunkCount: 1,
        windows: [
            {
                firstActivityTime,
                lastActivityTime: firstActivityTime,
                fromVersion: 0,
                toVersion: 5,
            },
            {
                firstActivityTime: resetActivityTime,
                lastActivityTime: continuedActivityTime,
                fromVersion: 0,
                toVersion: 2,
            },
        ],
    });
});

test("activity entries are ordered by their latest update", async () => {
    const actionContext = context.action(session);
    const taskId = await createTask();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    await processTaskActivityEntriesByTaskId(
        actionContext,
        space.id,
        actor,
        generateId<TaskActionTransactionId>(),
        new Map<TaskId, ReadonlyArray<TaskActivityEntryChange>>([
            [
                taskId,
                [
                    {
                        type: "TaskPriorityUpdated",
                        actionTime: [addMinutes(firstActivityTime, 5).getTime(), 0],
                        priority: "High",
                    },
                ],
            ],
        ]),
    );
    // Extends the notes window past the priority update, moving it later in the feed.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 9),
            startVersion: 4,
            endVersion: 9,
            beforeContentHash: "draft",
            afterContentHash: "final",
        }),
    });

    const {entriesResult} = await getTaskActivityEntries(actionContext, {
        taskId,
    });

    // The `TaskCreated` entry sorts last because the commit happened at the current
    // time while the manually applied updates use historical times.
    const labels = entriesResult.items
        .flatMap(item => {
            const model = item.model;
            if (model instanceof TaskActivityFeedDiscreteEntryModel) {
                return model.changes.map(change => ({
                    time: new Date(change.actionTime[0]),
                    label: change.type,
                }));
            }
            if (model instanceof TaskActivityFeedWindowChunkModel) {
                return decodeTaskActivityWindows(model).map(window => ({
                    time: window.lastActivityTime,
                    label: `${model.contentField}Window`,
                }));
            }
            return [];
        })
        .sort((label1, label2) => label1.time.getTime() - label2.time.getTime())
        .map(label => label.label);
    expect(labels).toEqual(["TaskPriorityUpdated", "NotesWindow", "TaskCreated"]);
});

test("activity backfill returns the latest event for an updated window", async () => {
    const actionContext = context.action(session);
    const taskId = await createTask();
    const checkpoint = generateServerSynchronizationCheckpointForTest();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, 1),
            startVersion: 4,
            endVersion: 9,
            beforeContentHash: "draft",
            afterContentHash: "final",
        }),
    });

    const result = await backfillTaskActivity(actionContext, {taskId, checkpoint});

    assert(result.type === "Available");
    expect({
        eventCount: result.events.length,
        window: decodeChunkEvent(result.events.at(-1) ?? null).at(-1),
    }).toMatchObject({eventCount: 2, window: {toVersion: 9}});
});

test("a window closes at the max duration while updates continue", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    // Each update lands within the 10-minute idle debounce of the previous one, but
    // the eighth crosses the one-hour max duration from the window's start, so it
    // opens a new window instead of extending the first forever.
    for (let version = 0; version < 8; version++) {
        await applyTaskActivityWindowUpdate(actionContext, {
            spaceId: space.id,
            taskId,
            update: notesUpdate({
                activityTime: addMinutes(firstActivityTime, version * 9),
                startVersion: version,
                endVersion: version + 1,
                beforeContentHash: `v${version}`,
                afterContentHash: `v${version + 1}`,
            }),
        });
    }

    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: addMinutes(firstActivityTime, 54),
                fromVersion: 0,
                toVersion: 7,
            },
            {firstActivityTime: addMinutes(firstActivityTime, 63), fromVersion: 7, toVersion: 8},
        ],
    });
});

test("a full chunk rolls over into a new chunk with its predecessor sealed", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    // Spaced past the idle debounce so every update opens its own window, far past
    // what the byte cap can hold in one chunk.
    let appliedCount = 0;
    let result = await queryTaskActivityWindows(actionContext, taskId);
    for (let index = 0; index < 150 && result.chunkCount < 2; index++) {
        await applyTaskActivityWindowUpdate(actionContext, {
            spaceId: space.id,
            taskId,
            update: notesUpdate({
                activityTime: addMinutes(firstActivityTime, index * 11),
                startVersion: index,
                endVersion: index + 1,
                beforeContentHash: `v${index}`,
                afterContentHash: `v${index + 1}`,
            }),
        });
        appliedCount++;
        if (appliedCount % 10 === 0) {
            result = await queryTaskActivityWindows(actionContext, taskId);
        }
    }
    result = await queryTaskActivityWindows(actionContext, taskId);
    assert(result.chunkCount === 2, "Expected the chunk to roll over within bounds");

    // Every window survived the rollover, in time order with contiguous versions — and
    // the open window keeps absorbing in the new chunk (a stale absorb into the sealed
    // predecessor would fail its bumped update lock instead).
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: addMinutes(firstActivityTime, (appliedCount - 1) * 11 + 1),
            startVersion: appliedCount,
            endVersion: appliedCount + 1,
            beforeContentHash: `v${appliedCount}`,
            afterContentHash: `v${appliedCount + 1}`,
        }),
    });

    const {chunkCount, windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect({
        chunkCount,
        windowCount: windows.length,
        isSortedWithContiguousVersions: windows.every(
            (window, index) =>
                window.fromVersion === index &&
                (index === 0 ||
                    window.firstActivityTime > assertExists(windows[index - 1]).lastActivityTime),
        ),
        openWindowToVersion: assertExists(windows.at(-1)).toVersion,
    }).toEqual({
        chunkCount: 2,
        windowCount: appliedCount,
        isSortedWithContiguousVersions: true,
        openWindowToVersion: appliedCount + 1,
    });
});

test("an absorb that overflows the chunk migrates the open window", async () => {
    const overflowActorAccounts = await runAllPromises(
        Array.from({length: 8}, async () => {
            const account = await TestAccount.create(context);
            await addSpaceAccountForTest(context, {
                spaceId: space.id,
                accountId: account.id,
            });
            return account;
        }),
    );
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    // Fill the open chunk until less than 150 bytes of headroom remain (each
    // same-actor window adds well under that, so the fill itself never rolls over).
    let windowCount = 0;
    let lastActivityTime = firstActivityTime;
    for (let index = 0; index < 200; index++) {
        lastActivityTime = addMinutes(firstActivityTime, index * 11);
        await applyTaskActivityWindowUpdate(actionContext, {
            spaceId: space.id,
            taskId,
            update: notesUpdate({
                activityTime: lastActivityTime,
                startVersion: index,
                endVersion: index + 1,
                beforeContentHash: `v${index}`,
                afterContentHash: `v${index + 1}`,
            }),
        });
        windowCount++;

        const {chunkCount, windows} = await queryTaskActivityWindows(actionContext, taskId);
        assert(chunkCount === 1, "The fill loop must not roll the chunk over itself");
        const encoded = encodeTaskActivityWindows(
            windows,
            assertExists(windows[0]).firstActivityTime,
        );
        if (
            taskActivityWindowChunkMaxByteLength - getTaskActivityWindowChunkByteLength(encoded) <
            150
        ) {
            break;
        }
    }

    // Eight unique-actor absorbs into the open window grow the chunk's actor
    // dictionary past the remaining headroom: one of them overflows, migrating the
    // still-open window to a fresh chunk while the sealed predecessor keeps the rest.
    for (let index = 0; index < 8; index++) {
        await applyTaskActivityWindowUpdate(actionContext, {
            spaceId: space.id,
            taskId,
            update: notesUpdate({
                activityTime: addMinutes(lastActivityTime, index + 1),
                startVersion: windowCount + index,
                endVersion: windowCount + index + 1,
                beforeContentHash: `a${index}`,
                afterContentHash: `a${index + 1}`,
                updateActor: {
                    accountId: assertExists(overflowActorAccounts[index]).id,
                    from: null,
                },
            }),
        });
    }

    const {chunkCount, windows} = await queryTaskActivityWindows(actionContext, taskId);
    expect({
        chunkCount,
        windowCount: windows.length,
        openWindow: assertExists(windows.at(-1)),
    }).toMatchObject({
        chunkCount: 2,
        windowCount,
        openWindow: {
            firstActivityTime: lastActivityTime,
            lastActivityTime: addMinutes(lastActivityTime, 8),
            // The original contributor plus the eight absorbed ones.
            totalActorCount: 9,
        },
    });
});

test("racing appliers place both updates exactly once", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const earlierActivityTime = new Date("2026-01-01T12:00:00.000Z");
    const laterActivityTime = addMinutes(earlierActivityTime, 20);

    // The first applier pauses after reading the (empty) chunk state...
    const pausePromise = applyTaskActivityWindowUpdateAfterReadTestCheckpoint.pauseForTest({
        taskId,
        activityTimeMs: earlierActivityTime.getTime(),
    });
    const pausedApplyPromise = applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: earlierActivityTime,
            startVersion: 0,
            endVersion: 1,
            beforeContentHash: "v0",
            afterContentHash: "v1",
        }),
    });
    const pause = await pausePromise;

    // ...while a second applier commits chunk 1 underneath it.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: laterActivityTime,
            startVersion: 1,
            endVersion: 2,
            beforeContentHash: "v1",
            afterContentHash: "v2",
        }),
    });
    pause.unpause();
    await pausedApplyPromise;

    // The stale attempt tried to create chunk 1, collided with the winner's
    // conditional create, and retried against strong reads — landing its window in
    // time order without duplicating either update.
    expect(await queryTaskActivityWindows(actionContext, taskId)).toMatchObject({
        chunkCount: 1,
        windows: [
            {firstActivityTime: earlierActivityTime, fromVersion: 0, toVersion: 1},
            {firstActivityTime: laterActivityTime, fromVersion: 1, toVersion: 2},
        ],
    });
});

test("a chunk written in an unknown format is skipped, not crashed on", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = new Date("2026-01-01T12:00:00.000Z");

    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: notesUpdate({
            activityTime: firstActivityTime,
            startVersion: 0,
            endVersion: 4,
            beforeContentHash: "empty",
            afterContentHash: "draft",
        }),
    });

    // Rewrite the chunk's header as if a newer build wrote it. Reads skip the whole
    // chunk rather than misinterpreting records they don't understand, and the next
    // write re-encodes it with this build's header — the version can't drift from the
    // records because they're the same value.
    const [chunk] = (await queryTaskActivityWindows(actionContext, taskId)).chunks;
    const staleChunk = assertExists(chunk);
    await TaskActivityTable.directlyUpdateItem(
        actionContext,
        staleChunk.update({
            windows: [
                new Uint8Array([taskActivityWindowFormatVersion + 1]),
                ...staleChunk.windows.slice(1),
            ],
        }),
    );

    expect((await queryTaskActivityWindows(actionContext, taskId)).windows).toEqual([]);
});

test("a backfilled update within the open window\u2019s backward bound joins it", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = await createTitleWindowsAroundBackfillGap(actionContext, taskId);

    // T5 is closer to the earlier window, but it is still within the open window's
    // two-minute backward bound. Rule 2 extends that open window before rule 4
    // considers the nearest historical window.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: addMinutes(firstActivityTime, 5),
            startVersion: 4,
            endVersion: 8,
            beforeTitleText: "v4",
            afterTitleText: "v8",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId, "Title")).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: addMinutes(firstActivityTime, 4),
                fromVersion: 0,
                toVersion: 4,
            },
            {
                firstActivityTime: addMinutes(firstActivityTime, 5),
                lastActivityTime: addMinutes(firstActivityTime, 10),
                fromVersion: 4,
                toVersion: 12,
            },
        ],
    });
});

test("a backfilled update between windows joins the nearest later window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = await createTitleWindowsAroundBackfillGap(actionContext, taskId);

    // T6 is two minutes after the earlier window and one before the later one.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: addMinutes(firstActivityTime, 6),
            startVersion: 4,
            endVersion: 8,
            beforeTitleText: "v4",
            afterTitleText: "v8",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId, "Title")).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: addMinutes(firstActivityTime, 4),
                fromVersion: 0,
                toVersion: 4,
            },
            {
                firstActivityTime: addMinutes(firstActivityTime, 6),
                lastActivityTime: addMinutes(firstActivityTime, 10),
                fromVersion: 4,
                toVersion: 12,
            },
        ],
    });
});

test("a backfilled update inside a window joins that window", async () => {
    const actionContext = context.action(session);
    const taskId = generateId<TaskId>();
    const firstActivityTime = await createTitleWindowsAroundBackfillGap(actionContext, taskId);

    // T8 lies inside the later window's T7–T10 activity range.
    await applyTaskActivityWindowUpdate(actionContext, {
        spaceId: space.id,
        taskId,
        update: titleUpdate({
            activityTime: addMinutes(firstActivityTime, 8),
            startVersion: 4,
            endVersion: 8,
            beforeTitleText: "v4",
            afterTitleText: "v8",
        }),
    });

    expect(await queryTaskActivityWindows(actionContext, taskId, "Title")).toMatchObject({
        windows: [
            {
                firstActivityTime,
                lastActivityTime: addMinutes(firstActivityTime, 4),
                fromVersion: 0,
                toVersion: 4,
            },
            {
                firstActivityTime: addMinutes(firstActivityTime, 7),
                lastActivityTime: addMinutes(firstActivityTime, 10),
                fromVersion: 4,
                toVersion: 12,
            },
        ],
    });
});
