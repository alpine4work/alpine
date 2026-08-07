import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {getTaskActivityWindowAggregationRule} from "~/server/tasks/data/internal/get_task_activity_window_aggregation_rule.js";
import {
    TaskActivityTable,
    TaskActivityWindowChunkDynamoItem,
    TaskActivityWindowSnapshotContent,
} from "~/server/tasks/data/internal/task_activity_table.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {SpaceId, TaskActivityEntryId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {getTaskActorKey} from "~/shared/tasks/get_task_actor_key.js";
import {
    TaskActivityWindowChunkActor,
    TaskActivityWindowForActor,
    countTaskActivityWindowChunkActors,
    decodeTaskActivityWindows,
    encodeTaskActivityWindows,
    getTaskActivityWindowChunkByteLength,
    maxActorDictionarySize,
    taskActivityWindowChunkMaxByteLength,
} from "~/shared/tasks/task_activity_window_chunk.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";

/** A decoded activity window used by the server-side window engine. */
type TaskActivityWindow = TaskActivityWindowForActor<TaskCreator>;

/**
 * One normalized title/notes source update headed for the field's window chunks:
 * who, when, the version step it covers, and the content state on either side of
 * it. The before state seeds the window snapshot's START state; the after state is
 * what `wasReverted` compares against. Lives here with the engine that consumes
 * it.
 */
export type TaskActivityWindowUpdate = {
    readonly actor: TaskCreator | null;
    readonly activityTime: Date;
    /**
     * The doc-carried version step this update covers: `titleIndexVersion` on the task
     * index doc for titles, the step transaction's version range for notes. Always
     * present — version coverage is the engine's only redelivery dedup.
     */
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly content:
        | {
              readonly type: "Title";
              readonly beforeTitleText: string | null;
              readonly afterTitleText: string | null;
          }
        | {
              readonly type: "Notes";
              readonly beforeContentHash: string | null;
              readonly afterContentHash: string;
          };
};

export const applyTaskActivityWindowUpdateAfterReadTestCheckpoint = new TestCheckpoint<{
    taskId: TaskId;
    activityTimeMs: number;
}>();

/**
 * Places one source update into its field's windows. The placement rules, in
 * order:
 *
 * 1. An update an existing window already covers — or that's below all loaded
 *    history — is a redelivery and drops (see
 *    `getTaskActivityWindowUpdateCoverage()`).
 * 2. An update that extends the latest editing era — before the open window's
 *    debounce deadline and no further than one idle-debounce before its start —
 *    absorbs into the open window.
 * 3. An update at or past the end of loaded history that doesn't extend the open
 *    window starts a new window at the end. The first window ever and a
 *    version-reset epoch also land here.
 * 4. Anything left arrived out of order into the middle of history. Within one
 *    idle-debounce of a loaded window's edge it absorbs into that window, moving
 *    the edge — the window may exceed the max duration this way; accepted, it's
 *    rare. Beyond that it becomes its own window inserted in time order — the
 *    target chunk may exceed the soft byte cap; also accepted, since dense chunk
 *    numbers rule out mid-history splits.
 */
export async function applyTaskActivityWindowUpdate(
    context: ServerActionContext,
    {
        spaceId,
        taskId,
        update,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        update: TaskActivityWindowUpdate;
    },
): Promise<void> {
    let hasConflicted = false;

    await context.dynamo.retryTransaction(async context => {
        // Eventual reads by default; a conflict means this attempt raced another writer or
        // read stale state, so retries pay for strong reads.
        const consistency: DynamoCacheReadConsistency | undefined = hasConflicted
            ? "StrongWithinCache"
            : undefined;
        hasConflicted = true;

        const chunkItems = await getLatestWindowChunkItems(context, {
            spaceId,
            taskId,
            contentField: update.content.type,
            consistency,
        });

        await applyTaskActivityWindowUpdateAfterReadTestCheckpoint.waitForTest({
            taskId,
            activityTimeMs: update.activityTime.getTime(),
        });

        const latestChunk = chunkItems[0] ?? null;

        const windows = latestChunk !== null ? decodeTaskActivityWindows(latestChunk) : [];
        const previousChunkWindows =
            chunkItems[1] !== undefined ? decodeTaskActivityWindows(chunkItems[1]) : [];

        // Whether window history extends below the two loaded chunks. Dense chunk numbers
        // make this a local check: chunks below the oldest loaded one exist exactly when
        // its number is above 1.
        const oldestLoadedChunk = chunkItems[1] ?? chunkItems[0];
        const hasUnloadedOlderChunks =
            oldestLoadedChunk !== undefined && oldestLoadedChunk.chunkNumber > 1;

        const coverage = getTaskActivityWindowUpdateCoverage(update, {
            loadedWindows: [...previousChunkWindows, ...windows],
            hasUnloadedOlderChunks,
        });
        if (coverage === "Covered") return;

        // Only rollover seals chunks, and a rollover creates its successor in the same
        // transaction — so a sealed LATEST chunk means this eventual read is stale (the
        // successor exists but wasn't visible). Don't absorb into it; the conditional
        // create in `createWindowFromUpdate()` collides with the unseen successor and
        // retries against strong reads.
        const openWindow =
            coverage === "VersionReset" || latestChunk?.sealedTime !== null
                ? undefined
                : windows.at(-1);

        // All times are server-generated commit times, so they only disagree by clock skew
        // between servers (sub-second with AWS Time Sync). Boundary comparisons lean
        // toward joining since the 10–15 minute windows dwarf the skew. The deadline is
        // computed from the window's own times instead of being stored, so debounce config
        // changes apply to open windows immediately.
        const rule = getTaskActivityWindowAggregationRule(update.content.type);
        const startsBeforeWindowDebounceEnds =
            openWindow !== undefined &&
            isDatePossiblyLessThanWithUncertaintyWindow(
                update.activityTime,
                getTaskActivityWindowDebounceEnd({
                    firstActivityTime: openWindow.firstActivityTime,
                    lastActivityTime: openWindow.lastActivityTime,
                    idleDebounceMs: rule.idleDebounceMs,
                    maxDurationMs: rule.maxDurationMs,
                }),
            );

        // The backward bound: caps how far BEFORE the window's start an update may land
        // (one idle-debounce). Without it, an hours-late redelivered job — whose
        // `activityTime` is its original commit time — would join the current window and
        // drag `firstActivityTime` hours into the past, stretching one "editing burst"
        // across a workday. With it, that stale delivery opens its own window.
        const isNotStaleRedelivery =
            openWindow !== undefined &&
            isDatePossiblyLessThanWithUncertaintyWindow(
                openWindow.firstActivityTime.getTime() - update.activityTime.getTime(),
                rule.idleDebounceMs,
            );

        // Rule 2: extend the open window.
        if (startsBeforeWindowDebounceEnds && isNotStaleRedelivery) {
            assert(latestChunk !== null && openWindow !== undefined);
            await absorbUpdateIntoWindow(context, {
                spaceId,
                taskId,
                update,
                chunkItem: latestChunk,
                windows,
                targetWindow: openWindow,
                canRollOver: true,
                consistency,
            });
            return;
        }

        // Rule 3: start a new window at the end.
        const latestLoadedWindow = windows.at(-1) ?? previousChunkWindows.at(-1);
        if (
            coverage === "VersionReset" ||
            latestLoadedWindow === undefined ||
            update.activityTime >= latestLoadedWindow.lastActivityTime
        ) {
            await createWindowFromUpdate(context, {spaceId, taskId, update, latestChunk, windows});
            return;
        }

        // Rule 4: the update landed out of order in the middle of loaded history. Find the
        // nearest loaded window by time (ties prefer the later window).
        assert(latestChunk !== null, "Loaded windows imply a loaded chunk");
        let nearest: {
            chunkItem: TaskActivityWindowChunkDynamoItem;
            chunkWindows: ReadonlyArray<TaskActivityWindow>;
            window: TaskActivityWindow;
            distanceMs: number;
        } | null = null;
        const loadedChunks = [
            ...(chunkItems[1] !== undefined
                ? [{chunkItem: chunkItems[1], chunkWindows: previousChunkWindows}]
                : []),
            {chunkItem: latestChunk, chunkWindows: windows},
        ];
        for (const {chunkItem, chunkWindows} of loadedChunks) {
            for (const window of chunkWindows) {
                const distanceMs =
                    update.activityTime < window.firstActivityTime
                        ? window.firstActivityTime.getTime() - update.activityTime.getTime()
                        : Math.max(
                              0,
                              update.activityTime.getTime() - window.lastActivityTime.getTime(),
                          );
                if (nearest === null || distanceMs <= nearest.distanceMs) {
                    nearest = {chunkItem, chunkWindows, window, distanceMs};
                }
            }
        }
        assert(nearest !== null, "Rule 3 handled the no-windows case");

        // The chunk's actor dictionary is a hard encoding limit (1-byte indices), and
        // unlike the open-window path a mid-history write can't roll the chunk over (dense
        // numbers rule out splits). In the ultra-rare case where the update's actor
        // doesn't fit its target chunk, fall back to a window at the end of history — out
        // of time order, but validly encoded (see the ascending note on
        // `getTaskActivityWindowUpdateCoverage()`).
        const updateActorKey = getTaskActorKey(update.actor);
        const wouldExceedActorCap =
            update.actor !== null &&
            countTaskActivityWindowChunkActors(nearest.chunkWindows) >= maxActorDictionarySize &&
            !nearest.chunkWindows.some(window =>
                window.actors.some(actor => getTaskActorKey(actor) === updateActorKey),
            );
        if (wouldExceedActorCap) {
            await createWindowFromUpdate(context, {spaceId, taskId, update, latestChunk, windows});
            return;
        }

        if (nearest.distanceMs <= rule.idleDebounceMs) {
            await absorbUpdateIntoWindow(context, {
                spaceId,
                taskId,
                update,
                chunkItem: nearest.chunkItem,
                windows: nearest.chunkWindows,
                targetWindow: nearest.window,
                canRollOver:
                    nearest.chunkItem === latestChunk &&
                    latestChunk.sealedTime === null &&
                    nearest.window === windows.at(-1),
                consistency,
            });
            return;
        }

        await insertWindowInOrderFromUpdate(context, {
            spaceId,
            taskId,
            update,
            chunkItem: nearest.chunkItem,
            chunkWindows: nearest.chunkWindows,
        });
    });
}

/**
 * Whether an existing window already covers the update — the marker-free
 * redelivery check. A window whose version range contains the update's absorbed it
 * before. When history extends below the loaded chunks, an update entirely below
 * the oldest loaded window is also treated as covered: the two loaded chunks span
 * ~months of windows while SQS redelivers for at most 14 days, so an unloaded
 * older window must have absorbed it. With all chunks loaded there is no such
 * horizon — an uncontained update is genuinely new (e.g. the earliest batch
 * delivered late) and must be placed.
 *
 * IMPORTANT: Assumes windows are sorted in ascending time order. Placement rule 4
 * inserts out-of-order updates in order to preserve this; the rare actor-cap
 * fallback may append out of order, which only weakens the latest-window
 * heuristics below, never the containment check.
 */
function getTaskActivityWindowUpdateCoverage(
    update: TaskActivityWindowUpdate,
    {
        loadedWindows,
        hasUnloadedOlderChunks,
    }: {
        loadedWindows: ReadonlyArray<TaskActivityWindow>;
        hasUnloadedOlderChunks: boolean;
    },
): "Covered" | "VersionReset" | "Uncovered" {
    let oldestLoadedFromVersion: number | null = null;
    let isContainedByOlderWindow = false;
    for (const window of loadedWindows) {
        if (window.fromVersion === null || window.toVersion === null) continue;
        if (update.fromVersion >= window.fromVersion && update.toVersion <= window.toVersion) {
            // A replay carries the source update's original activity time. A newly committed
            // update inside an old range instead means the doc-carried counter was reset (for
            // example by a rollback).
            if (update.activityTime <= window.lastActivityTime) return "Covered";
            isContainedByOlderWindow = true;
        }
        if (oldestLoadedFromVersion === null || window.fromVersion < oldestLoadedFromVersion) {
            oldestLoadedFromVersion = window.fromVersion;
        }
    }

    const isBelowUnloadedHistory =
        hasUnloadedOlderChunks &&
        oldestLoadedFromVersion !== null &&
        update.toVersion <= oldestLoadedFromVersion;
    if (!isContainedByOlderWindow && !isBelowUnloadedHistory) return "Uncovered";

    // Loaded windows should be non-empty, so we can safely assert that the latest
    // window exists.
    const latestLoadedWindow = assertExists(loadedWindows.at(-1));

    // Once a reset opens a new epoch, its next update continues from the latest
    // range's end. Do not repeatedly classify `1 -> 2`, `2 -> 3`, ... as resets merely
    // because a much older pre-rollback window also covered those numbers.
    if (update.fromVersion === latestLoadedWindow.toVersion) return "Uncovered";

    return update.activityTime > latestLoadedWindow.lastActivityTime ? "VersionReset" : "Covered";
}

/**
 * Absorbs an update into `targetWindow`. The common case — same contributors,
 * in-order delivery — writes only the chunk item; the snapshot joins the
 * transaction only when the update moves the window's start (its start state
 * changes) or adds a contributor (the snapshot holds the full dedup actor list the
 * chunk's capped records can't).
 *
 * `canRollOver` marks the one target that may migrate to a fresh chunk on
 * overflow: the open tail of the unsealed latest chunk. Any other target's chunk
 * can't split (dense numbers), so its rewrite may exceed the soft byte cap — the
 * caller pre-checks the hard actor-dictionary limit.
 */
async function absorbUpdateIntoWindow(
    context: ServerActionContext,
    {
        spaceId,
        taskId,
        update,
        chunkItem,
        windows,
        targetWindow,
        canRollOver,
        consistency,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        update: TaskActivityWindowUpdate;
        chunkItem: TaskActivityWindowChunkDynamoItem;
        windows: ReadonlyArray<TaskActivityWindow>;
        targetWindow: TaskActivityWindow;
        canRollOver: boolean;
        consistency: DynamoCacheReadConsistency | undefined;
    },
): Promise<void> {
    // The snapshot supplies the window's start state (for `wasReverted`) and its FULL
    // dedup actor list (chunk records cap stored actors). It's created transactionally
    // with its window and rewritten only on start-moves and new contributors, so it's
    // nearly immutable — eventual-then-strong covers the just-created case without
    // paying strong on every absorb.
    const windowSnapshotItemKey = {
        partitionType: "Task",
        sortRangeType: "WindowSnapshot",
        spaceId,
        taskId,
        activityEntryId: targetWindow.activityEntryId,
    } as const;
    const windowSnapshotItem =
        consistency !== undefined
            ? await TaskActivityTable.getItem(context, windowSnapshotItemKey, {consistency})
            : await TaskActivityTable.getItemWithEventualThenStrongConsistency(
                  context,
                  windowSnapshotItemKey,
              );

    // Version ordering is authoritative (job delivery reorders wall-clock arrival,
    // versions don't lie); the activity-time fallback covers stored windows written
    // before updates always carried versions. Coverage filtering already dropped
    // contained updates, so a version tie means the boundary doesn't move.
    const movesStart =
        targetWindow.fromVersion !== null
            ? update.fromVersion < targetWindow.fromVersion
            : update.activityTime < targetWindow.firstActivityTime;
    const movesEnd =
        targetWindow.toVersion !== null
            ? update.toVersion > targetWindow.toVersion
            : update.activityTime >= targetWindow.lastActivityTime;

    const previousStartState = getWindowSnapshotStartState(windowSnapshotItem.content);
    const startState = movesStart ? getWindowUpdateBeforeState(update) : previousStartState;

    // Reverted = start state equals end state. The end state is only known when this
    // update supplies it (it moved the end); a pure start-move can't always recompute
    // the flag because the end lives in no item — when the window wasn't reverted we
    // keep "not reverted", accepting that the rare out-of-order start-move whose new
    // start happens to equal the unknown end misses a revert (display-only, and the
    // next end-moving absorb corrects it).
    let wasReverted: boolean;
    if (movesEnd) {
        const endState = getWindowUpdateAfterState(update);
        wasReverted = startState !== null && startState === endState;
    } else if (movesStart) {
        wasReverted = targetWindow.wasReverted
            ? startState !== null && startState === previousStartState
            : false;
    } else {
        wasReverted = targetWindow.wasReverted;
    }

    const snapshotActors = appendTaskActorIfNew(windowSnapshotItem.actors, update.actor);
    const hasNewActor = snapshotActors.length !== windowSnapshotItem.actors.length;

    const updatedTargetWindow: TaskActivityWindow = {
        ...targetWindow,
        firstActivityTime:
            update.activityTime < targetWindow.firstActivityTime
                ? update.activityTime
                : targetWindow.firstActivityTime,
        lastActivityTime:
            update.activityTime > targetWindow.lastActivityTime
                ? update.activityTime
                : targetWindow.lastActivityTime,
        fromVersion: movesStart ? update.fromVersion : targetWindow.fromVersion,
        toVersion: movesEnd ? update.toVersion : targetWindow.toVersion,
        wasReverted,
        actors: snapshotActors,
        totalActorCount: snapshotActors.length,
    };

    const snapshotTransactionEntries =
        movesStart || hasNewActor
            ? [
                  TaskActivityTable.transactionDirectlyUpdateItem(
                      windowSnapshotItem.update({
                          content: movesStart
                              ? createSnapshotContentFromUpdate(update)
                              : windowSnapshotItem.content,
                          actors: snapshotActors,
                      }),
                  ),
              ]
            : [];

    const updatedWindows = windows.map(window =>
        window === targetWindow ? updatedTargetWindow : window,
    );
    const updated = encodeWindowsForChunk(updatedWindows, chunkItem.baseTime);

    const fits =
        fitsInWindowChunk(updated) &&
        countTaskActivityWindowChunkActors(updatedWindows) <= maxActorDictionarySize;
    if (fits || !canRollOver) {
        const {transactionEntry} = TaskActivityTable.transactionDirectlyUpdateItemWithEvent(
            chunkItem.update({
                baseTime: updated.baseTime,
                actors: updated.actors,
                windows: updated.windows,
            }),
        );

        await RynamoTableSchema.executeTransaction(context, [
            transactionEntry,
            ...snapshotTransactionEntries,
        ]);
        return;
    }

    // The absorb overflowed the chunk: the still-open window migrates to a fresh chunk
    // so it can keep absorbing, and the old chunk keeps the closed windows and is
    // sealed (rewriting it is what invalidates concurrent stale absorbs).
    assert(targetWindow === windows.at(-1), "Only the open tail can roll over");
    const remainingWindows = windows.slice(0, -1);
    assert(remainingWindows.length > 0, "A single window can\u2019t overflow a chunk");

    const remaining = encodeWindowsForChunk(remainingWindows, chunkItem.baseTime);
    const {transactionEntry} = TaskActivityTable.transactionCreateItemWithEvent(
        createWindowChunkItem(
            {spaceId, taskId, contentField: update.content.type},
            chunkItem.chunkNumber + 1,
            [updatedTargetWindow],
        ),
        {isConditionCheckErrorRetriable: true},
    );

    await RynamoTableSchema.executeTransaction(context, [
        TaskActivityTable.transactionDirectlyUpdateItem(
            chunkItem.update({
                sealedTime: new Date(),
                baseTime: remaining.baseTime,
                actors: remaining.actors,
                windows: remaining.windows,
            }),
        ),
        transactionEntry,
        ...snapshotTransactionEntries,
    ]);
}

/**
 * One new window and its snapshot create, shared by end-of-history creates and
 * in-order inserts.
 */
function createWindowAndSnapshotFromUpdate({
    spaceId,
    taskId,
    update,
}: {
    spaceId: SpaceId;
    taskId: TaskId;
    update: TaskActivityWindowUpdate;
}) {
    const beforeState = getWindowUpdateBeforeState(update);
    const afterState = getWindowUpdateAfterState(update);
    const window: TaskActivityWindow = {
        activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
        firstActivityTime: update.activityTime,
        lastActivityTime: update.activityTime,
        wasReverted: beforeState !== null && beforeState === afterState,
        fromVersion: update.fromVersion,
        toVersion: update.toVersion,
        actors: [update.actor],
        totalActorCount: 1,
    };

    const snapshotTransactionEntry = TaskActivityTable.transactionCreateItem({
        partitionType: "Task",
        sortRangeType: "WindowSnapshot",
        spaceId,
        taskId,
        activityEntryId: window.activityEntryId,
        content: createSnapshotContentFromUpdate(update),
        actors: [update.actor],
    });

    return {window, snapshotTransactionEntry};
}

/**
 * Opens a new window at the end of history (placement rule 3): appended to the
 * latest chunk while it has room, otherwise into a fresh chunk. Creating chunk N+1
 * conditionally creates the next dense number AND seals chunk N in the same
 * transaction — the losing side of a create race fails its condition and retries
 * against strong reads, and any stale absorb into N fails N's bumped update lock.
 */
async function createWindowFromUpdate(
    context: ServerActionContext,
    {
        spaceId,
        taskId,
        update,
        latestChunk,
        windows,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        update: TaskActivityWindowUpdate;
        latestChunk: TaskActivityWindowChunkDynamoItem | null;
        windows: ReadonlyArray<TaskActivityWindow>;
    },
): Promise<void> {
    const {window, snapshotTransactionEntry} = createWindowAndSnapshotFromUpdate({
        spaceId,
        taskId,
        update,
    });

    // Append to the latest chunk while it stays under the byte cap and the actor
    // dictionary limit. A sealed latest chunk means the read was stale (its successor
    // exists but wasn't visible) — fall through to the conditional create, which
    // collides with the unseen successor and retries against strong reads.
    if (latestChunk !== null && latestChunk.sealedTime === null) {
        const appendedWindows = [...windows, window];
        const appended = encodeWindowsForChunk(appendedWindows, latestChunk.baseTime);
        if (
            fitsInWindowChunk(appended) &&
            countTaskActivityWindowChunkActors(appendedWindows) <= maxActorDictionarySize
        ) {
            const {transactionEntry} = TaskActivityTable.transactionDirectlyUpdateItemWithEvent(
                latestChunk.update({
                    baseTime: appended.baseTime,
                    actors: appended.actors,
                    windows: appended.windows,
                }),
            );

            await RynamoTableSchema.executeTransaction(context, [
                transactionEntry,
                snapshotTransactionEntry,
            ]);
            return;
        }
    }

    const {transactionEntry} = TaskActivityTable.transactionCreateItemWithEvent(
        createWindowChunkItem(
            {spaceId, taskId, contentField: update.content.type},
            (latestChunk?.chunkNumber ?? 0) + 1,
            [window],
        ),
        {isConditionCheckErrorRetriable: true},
    );

    await RynamoTableSchema.executeTransaction(context, [
        transactionEntry,
        // Seal the predecessor in the same transaction. Without this, a stale eventually
        // consistent reader that hasn't seen the new chunk could still absorb into the old
        // one's tail — the seal bumps its update lock so that write fails instead.
        ...(latestChunk !== null && latestChunk.sealedTime === null
            ? [
                  TaskActivityTable.transactionDirectlyUpdateItem(
                      latestChunk.update({sealedTime: new Date()}),
                  ),
              ]
            : []),
        snapshotTransactionEntry,
    ]);
}

/**
 * Places an out-of-order update as its own window at its sorted position inside
 * the chunk nearest to its time (placement rule 4). The rewrite may deliberately
 * target a rollover-sealed chunk — the seal guards against STALE absorbs into a
 * superseded tail, while this write knowingly rewrites the chunk with its current
 * update lock — and may exceed the soft byte cap, which only exists to bound
 * absorb rewrite costs.
 */
async function insertWindowInOrderFromUpdate(
    context: ServerActionContext,
    {
        spaceId,
        taskId,
        update,
        chunkItem,
        chunkWindows,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        update: TaskActivityWindowUpdate;
        chunkItem: TaskActivityWindowChunkDynamoItem;
        chunkWindows: ReadonlyArray<TaskActivityWindow>;
    },
): Promise<void> {
    const {window, snapshotTransactionEntry} = createWindowAndSnapshotFromUpdate({
        spaceId,
        taskId,
        update,
    });

    const nextWindowIndex = chunkWindows.findIndex(
        chunkWindow => chunkWindow.firstActivityTime > update.activityTime,
    );
    const updatedWindows =
        nextWindowIndex === -1
            ? [...chunkWindows, window]
            : chunkWindows.toSpliced(nextWindowIndex, 0, window);
    const updated = encodeWindowsForChunk(updatedWindows, chunkItem.baseTime);

    const {transactionEntry} = TaskActivityTable.transactionDirectlyUpdateItemWithEvent(
        chunkItem.update({
            baseTime: updated.baseTime,
            actors: updated.actors,
            windows: updated.windows,
        }),
    );

    await RynamoTableSchema.executeTransaction(context, [
        transactionEntry,
        snapshotTransactionEntry,
    ]);
}

function getWindowUpdateBeforeState(update: TaskActivityWindowUpdate): string | null {
    return update.content.type === "Title"
        ? update.content.beforeTitleText
        : update.content.beforeContentHash;
}

function getWindowUpdateAfterState(update: TaskActivityWindowUpdate): string | null {
    return update.content.type === "Title"
        ? update.content.afterTitleText
        : update.content.afterContentHash;
}

function getWindowSnapshotStartState(content: TaskActivityWindowSnapshotContent): string | null {
    return content.type === "Title" ? content.startTitleText : content.startContentHash;
}

function createSnapshotContentFromUpdate(
    update: TaskActivityWindowUpdate,
): TaskActivityWindowSnapshotContent {
    return update.content.type === "Title"
        ? {type: "Title", startTitleText: update.content.beforeTitleText}
        : {type: "Notes", startContentHash: update.content.beforeContentHash};
}

/**
 * Reads a field's latest two chunks, newest first. Two chunks span ~130 windows
 * (months of history) for the coverage check, and cost the same ~0.5 eventual RCU
 * as one — both fit inside a single 4Kb read unit.
 */
async function getLatestWindowChunkItems(
    context: ServerActionContext,
    {
        spaceId,
        taskId,
        contentField,
        consistency,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        contentField: "Title" | "Notes";
        consistency: DynamoCacheReadConsistency | undefined;
    },
): Promise<Array<TaskActivityWindowChunkDynamoItem>> {
    const sortRangeType = contentField === "Title" ? "TitleWindowChunks" : "NotesWindowChunks";
    const items = TaskActivityTable.query(context, {
        partitionKey: {partitionType: "Task", spaceId, taskId},
        startSortKey: {sortRangeType, chunkNumber: 1},
        endSortKey: {sortRangeType, chunkNumber: Number.MAX_SAFE_INTEGER},
        descending: true,
        limit: 2,
        ...(consistency !== undefined ? {consistency} : {}),
    });

    const chunkItems: Array<TaskActivityWindowChunkDynamoItem> = [];
    for await (const item of items) {
        chunkItems.push(item);
        if (chunkItems.length === 2) break;
    }
    return chunkItems;
}

/** Whether a chunk can hold these windows without rolling to a new item. */
function fitsInWindowChunk(encoded: {
    actors: ReadonlyArray<TaskActivityWindowChunkActor>;
    windows: ReadonlyArray<Uint8Array>;
}): boolean {
    return getTaskActivityWindowChunkByteLength(encoded) <= taskActivityWindowChunkMaxByteLength;
}

function createWindowChunkItem(
    {
        spaceId,
        taskId,
        contentField,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        contentField: "Title" | "Notes";
    },
    chunkNumber: number,
    windows: ReadonlyArray<TaskActivityWindow>,
) {
    // The chunk's base time starts at its first window's start; window records store
    // second deltas from it.
    const baseTime = assertExists(windows[0]).firstActivityTime;
    const encoded = encodeTaskActivityWindows(windows, baseTime);

    const chunkBase = {
        partitionType: "Task",
        spaceId,
        taskId,
        chunkNumber,
        sealedTime: null,
        baseTime,
        actors: encoded.actors,
        windows: encoded.windows,
    } as const;

    return contentField === "Title"
        ? {...chunkBase, sortRangeType: "TitleWindowChunks" as const}
        : {...chunkBase, sortRangeType: "NotesWindowChunks" as const};
}

// Re-derives the chunk's base time on every rewrite: an out-of-order absorb can
// move the open window's start before the stored base, and deltas clamp at 0.
function encodeWindowsForChunk(
    windows: ReadonlyArray<TaskActivityWindow>,
    itemBaseTime: Date,
): {
    baseTime: Date;
    actors: ReturnType<typeof encodeTaskActivityWindows>["actors"];
    windows: Array<Uint8Array>;
} {
    const baseTime = windows.reduce(
        (earliest, window) =>
            window.firstActivityTime < earliest ? window.firstActivityTime : earliest,
        itemBaseTime,
    );
    return {baseTime, ...encodeTaskActivityWindows(windows, baseTime)};
}

/**
 * Null actors are meaningful (a system update, rendered as "Alpine") and are
 * tracked like any contributor — dropping them would silently credit a system edit
 * to the humans in the same window. See the `actor` doc on
 * `TaskActivityEntryContentSchema`.
 */
function appendTaskActorIfNew(
    actors: ReadonlyArray<TaskCreator | null>,
    actor: TaskCreator | null,
): Array<TaskCreator | null> {
    const actorKey = getTaskActorKey(actor);
    const hasActor = actors.some(existingActor => getTaskActorKey(existingActor) === actorKey);
    return hasActor ? [...actors] : [...actors, actor];
}

function getTaskActivityWindowDebounceEnd({
    firstActivityTime,
    lastActivityTime,
    idleDebounceMs,
    maxDurationMs,
}: {
    firstActivityTime: Date;
    lastActivityTime: Date;
    idleDebounceMs: number;
    maxDurationMs: number;
}): Date {
    return new Date(
        Math.min(
            lastActivityTime.getTime() + idleDebounceMs,
            firstActivityTime.getTime() + maxDurationMs,
        ),
    );
}
