import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskActivityActor,
    TaskActivityChange,
    TaskActivityFeedDiscreteEntryModel,
} from "~/shared/tasks/task_activity.js";
import {TaskActivityWindowForActor} from "~/shared/tasks/task_activity_window_chunk.js";

/**
 * How long a read-time window stays open after its latest entry. Matches the
 * "fat-finger" horizon: consecutive same-actor updates to one field within this
 * gap render as a single feed item, and a fully reversed run renders as nothing.
 */
export const taskActivityFeedWindowMs = 2 * 60 * 1000;

/**
 * How long after creation the creator's setup activity folds into the "created the
 * task" item. Setting a task up is one act — rendering its parts separately would
 * clutter the feed of every task.
 */
const taskActivityCreationFoldWindowMs = 5 * 60 * 1000;

/**
 * How to identify a feed item. Aggregated activity uses the first contributing
 * source's identity so appending another source to a live run does not change its
 * React key. Creation uses the task id because it exists even when its stored
 * activity entry has not been backfilled.
 */
export type TaskActivityFeedItemId = `${TaskActivityEntryId}:${string}` | `Task:${TaskId}:Created`;

/** Data used to synthesize the feed's creation item. */
export type TaskActivityFeedCreation = {
    readonly taskId: TaskId;
    readonly actor: TaskActivityActor | null;
    readonly actionTime: HybridLogicalTime;
};

/**
 * One client-visible discrete change flattened from its transaction-level storage
 * entry. `changeIndex` keeps its identity stable when time-range reads select only
 * some of an entry's changes.
 */
type TaskActivityFeedDiscreteChange = {
    readonly taskId: TaskId;
    readonly activityEntryId: TaskActivityEntryId;
    readonly changeIndex: number;
    readonly actor: TaskActivityActor | null;
    readonly change: TaskActivityChange;
};

/**
 * One raw source retained by a derived item for a future activity-details view.
 * Content windows are already summaries at this layer, so they remain window
 * sources rather than pretending to contain every underlying document action.
 */
type TaskActivityFeedSourceActivity =
    | ({readonly type: "DiscreteChange"} & TaskActivityFeedDiscreteChange)
    | {
          readonly type: "ContentWindow";
          readonly window: TaskActivityFeedWindow;
      };

type TaskActivityFeedItemBase = {
    readonly feedItemId: TaskActivityFeedItemId;
    /** The time used to sort, display, and place this item between comments. */
    readonly feedItemTime: Date;
};

/**
 * One rendered discrete feed item: the change payload straight off the schema
 * union (before values from the run's first change, current values and
 * `actionTime` from its last) plus the feed identity. Derived from
 * `TaskActivityChange` rather than restated, so a new schema variant or field
 * flows through without a copy to update.
 */
export type TaskActivityFeedDiscreteItem = {
    /**
     * Stable identity from the first change in this run. Feed ordering does not depend
     * on this encoding.
     */
    readonly actor: TaskActivityActor | null;
    readonly sourceActivities: ReadonlyArray<TaskActivityFeedSourceActivity>;
} & TaskActivityFeedItemBase &
    Exclude<TaskActivityChange, {type: "TaskCollectionMembershipUpdated"}>;

type TaskActivityFeedCollectionMembershipItem = {
    readonly type: "TaskCollectionMembershipUpdated";
    readonly addedCollectionIds: ReadonlyArray<TaskCollectionId>;
    readonly removedCollectionIds: ReadonlyArray<TaskCollectionId>;
    readonly actor: TaskActivityActor | null;
    readonly sourceActivities: ReadonlyArray<TaskActivityFeedSourceActivity>;
} & TaskActivityFeedItemBase;

/** One rendered feed item derived from raw activity entries. */
export type TaskActivityFeedItem =
    | TaskActivityFeedDiscreteItem
    | TaskActivityFeedCollectionMembershipItem
    | (TaskActivityFeedItemBase &
          (
              | {
                    /**
                     * A run of title updates. Carries only the title log version range — a future
                     * "show changes" view folds the log across it; the feed copy names no text.
                     */
                    readonly type: "TitleWindow";
                    readonly fromVersion: number | null;
                    readonly toVersion: number | null;
                    /** The first contributors, in first-contribution order, capped at storage. */
                    readonly actors: ReadonlyArray<TaskActivityActor | null>;
                    /** Distinct contributors ever, including those beyond the stored cap. */
                    readonly totalActorCount: number;
                }
              | {
                    readonly type: "NotesWindow";
                    readonly fromVersion: number | null;
                    readonly toVersion: number | null;
                    /** The first contributors, in first-contribution order, capped at storage. */
                    readonly actors: ReadonlyArray<TaskActivityActor | null>;
                    /** Distinct contributors ever, including those beyond the stored cap. */
                    readonly totalActorCount: number;
                }
          ));

/**
 * A decoded activity window whose account references are hydrated for the client.
 */
export type TaskActivityClientWindow = TaskActivityWindowForActor<TaskActivityActor>;
/**
 * One title/notes window decoded from a chunk, tagged with its content field.
 */
export type TaskActivityFeedWindow = TaskActivityClientWindow & {
    readonly contentField: "Title" | "Notes";
};

type TaskActivityFeedMergedDiscreteItem = TaskActivityFeedDiscreteItem;

type TaskActivityFeedMergedCollectionMembershipItem = {
    readonly type: "TaskCollectionMembershipUpdated";
    readonly feedItemId: TaskActivityFeedItemId;
    readonly feedItemTime: Date;
    readonly membershipByCollectionId: ReadonlyMap<
        TaskCollectionId,
        {previousIsMember: boolean | null; currentIsMember: boolean}
    >;
    readonly actor: TaskActivityActor | null;
    readonly sourceActivities: ReadonlyArray<TaskActivityFeedSourceActivity>;
};

/**
 * The accumulator for one open run: the consecutive same-field, same-actor changes
 * merged so far, plus collection membership's per-collection net deltas needed to
 * finalize the run into a `TaskActivityFeedItem` (see `createFeedItemFromRun()`).
 * For example, the following actions
 *
 * ```
 * T0, Ian set the priority to high
 * T1, Ian set the priority to medium
 * T2, Ian set the priority to low
 * ```
 *
 * Would be merged into a single activity feed item
 *
 * ```
 * {
 *   type: "PriorityUpdated",
 *   feedItemTime: T2,
 *   actor: Ian,
 * }
 * ```
 */
type TaskActivityFeedMergedItem =
    | TaskActivityFeedMergedDiscreteItem
    | TaskActivityFeedMergedCollectionMembershipItem;

// The aggregation rules in plain english (also mirror any changes into the design
// doc once they settle):
//
// 1. One open run per field type. Consecutive updates to a field MERGE into one
//    feed item while they share an actor and each arrives within two minutes of
//    the previous one; a different actor touching the field, or a longer gap,
//    closes the run.
// 2. Comments do not affect derivation. The whole feed is derived once when its
//    realtime sources change, then the resulting items are sliced between
//    comments.
// 3. A merged run whose known before value equals its final value renders as
//    NOTHING (the fat-finger collapse). Unknown before values always render —
//    hiding a change we can't verify would drop real activity.
// 4. Collection membership aggregates to the net delta of a run across
//    collections; runs that net to no change disappear.
// 5. Title/notes windows were aggregated at write time and pass through as their
//    own items; reverted windows are dropped.
// 6. Setting a task up is one act, so activity within
//    `taskActivityCreationFoldWindowMs` of creation folds into a synthetic
//    creation item anchored to immutable task-model data. It's easiest to read as
//    the list of things that DON'T fold:
//
//     a. Anything by an actor who isn't the creator. b. Assigning the task to
//     someone other than the creator. (Assigning it to themselves, or clearing
//     that, is setup and folds.) c. Status changes. d. Deletion, and notes edits.
//
//     (a)-(c) are Ian's rule. (d) is ours: unlike the rest of setup, "deleted the
//     task" and "updated the notes" aren't configuration — folding them would make
//     the feed silently omit that the task was deleted or that its notes were
//     written, which is exactly what a reader is looking for. Everything else
//     (title, collection, priority, due date, parent, layout) folds.
//
//     A visible action does not stop later eligible creator setup from folding.
//
// 7. Aggregated items retain their raw source activities. Discrete runs use the
//    first source's identity so appending to a run does not change its key;
//    creation uses the task id and always sorts before the rest of the feed.
//
// A live aggregate's `feedItemTime` advances when it absorbs a later update. This
// can move the item within the feed, including across a comment boundary. That
// instability is acceptable: it keeps the timing model simple and is rare in
// practice.

/**
 * Applies the read-time aggregation rules to raw activity data (see the 2026-07-17
 * decision log): one open run per field type; a run breaks when a different actor
 * updates the field or the next update arrives past the window gap; merged runs
 * that net out to no change are dropped. Title/notes windows were already
 * aggregated at write time (decoded from binary window chunks) and pass through as
 * their own feed items (reverted ones are dropped).
 *
 * Entries and windows may be passed in any order. Discrete changes sort by their
 * source action's hybrid logical time — the same version that resolves CRDT
 * winners — while content windows sort by their last activity time. The result is
 * sorted by `feedItemTime`.
 */
export function deriveTaskActivityFeed({
    entries,
    windows,
    creation,
}: {
    entries: ReadonlyArray<TaskActivityFeedDiscreteEntryModel>;
    windows: ReadonlyArray<TaskActivityFeedWindow>;
    creation: TaskActivityFeedCreation | null;
}): Array<TaskActivityFeedItem> {
    let creationActivity: TaskActivityFeedCreation | null = null;

    const changes: Array<TaskActivityFeedDiscreteChange> = entries.flatMap(entry =>
        entry.changes.map((change, changeIndex) => {
            if (change.type === "TaskCreated") {
                creationActivity = {
                    taskId: entry.taskId,
                    actor: entry.actor,
                    actionTime: change.actionTime,
                };
            }
            return {
                taskId: entry.taskId,
                activityEntryId: entry.activityEntryId,
                changeIndex,
                actor: entry.actor,
                change,
            };
        }),
    );

    creationActivity ??= creation
        ? {
              taskId: creation.taskId,
              actor: creation.actor,
              actionTime: creation.actionTime,
          }
        : null;

    const sortedRawActivities = [
        ...changes.map(change => ({kind: "Change" as const, ...change})),
        ...windows.map(window => ({kind: "Window" as const, window})),
    ].sort((source1, source2) => {
        const time1: HybridLogicalTime =
            source1.kind === "Change"
                ? source1.change.actionTime
                : [source1.window.lastActivityTime.getTime(), 0];
        const time2: HybridLogicalTime =
            source2.kind === "Change"
                ? source2.change.actionTime
                : [source2.window.lastActivityTime.getTime(), 0];
        const timeComparison = compareHybridLogicalTimes(time1, time2);
        if (timeComparison !== 0) return timeComparison;

        const id1 =
            source1.kind === "Change" ? source1.activityEntryId : source1.window.activityEntryId;
        const id2 =
            source2.kind === "Change" ? source2.activityEntryId : source2.window.activityEntryId;
        if (id1 < id2) return -1;
        if (id1 > id2) return 1;

        if (source1.kind === "Change" && source2.kind === "Change") {
            return source1.changeIndex - source2.changeIndex;
        }
        if (source1.kind === source2.kind) return 0;
        return source1.kind === "Window" ? -1 : 1;
    });

    const feedItems: Array<TaskActivityFeedItem> = [];
    const creationSourceActivities: Array<TaskActivityFeedSourceActivity> = [];
    const openRunsByFieldType = new Map<TaskActivityChange["type"], TaskActivityFeedMergedItem>();

    const emitRun = (run: TaskActivityFeedMergedItem) => {
        const feedItem = createFeedItemFromRun(run);
        if (feedItem === null) return;

        feedItems.push(feedItem);
    };

    for (const rawActivity of sortedRawActivities) {
        if (rawActivity.kind === "Window") {
            const window = rawActivity.window;
            if (window.wasReverted) continue;

            const sourceActivity = {type: "ContentWindow" as const, window};
            if (
                creationActivity !== null &&
                isTaskActivitySourceFoldedIntoCreation(sourceActivity, creationActivity)
            ) {
                creationSourceActivities.push(sourceActivity);
                continue;
            }

            feedItems.push({
                type: window.contentField === "Title" ? "TitleWindow" : "NotesWindow",
                // We use 0 here to satisfy the typing of `TaskActivityFeedItemId`, and it's
                // guaranteed to be unique.
                feedItemId: `${window.activityEntryId}:0`,
                feedItemTime: window.lastActivityTime,
                fromVersion: window.fromVersion,
                toVersion: window.toVersion,
                actors: window.actors,
                totalActorCount: window.totalActorCount,
            });
            continue;
        }

        const activityTime = new Date(rawActivity.change.actionTime[0]);
        const sourceActivity: TaskActivityFeedSourceActivity = {
            type: "DiscreteChange",
            taskId: rawActivity.taskId,
            activityEntryId: rawActivity.activityEntryId,
            changeIndex: rawActivity.changeIndex,
            actor: rawActivity.actor,
            change: rawActivity.change,
        };

        // Folds most actions from the creator within the first 5 minutes into a single
        // creation entry. We can use `creationSourceActivities` to explain what all was
        // rolled into the creation entry.
        if (rawActivity.change.type === "TaskCreated") {
            creationSourceActivities.push(sourceActivity);
            continue;
        }

        if (
            creationActivity !== null &&
            isTaskActivitySourceFoldedIntoCreation(sourceActivity, creationActivity)
        ) {
            creationSourceActivities.push(sourceActivity);
            continue;
        }

        const fieldType = rawActivity.change.type;
        const openRun = openRunsByFieldType.get(fieldType);

        if (
            openRun !== undefined &&
            (getTaskActivityActorKey(openRun.actor) !==
                getTaskActivityActorKey(rawActivity.actor) ||
                activityTime.getTime() - openRun.feedItemTime.getTime() > taskActivityFeedWindowMs)
        ) {
            emitRun(openRun);
            openRunsByFieldType.delete(fieldType);
        }

        const currentRun = openRunsByFieldType.get(fieldType);

        const entry = {
            ...rawActivity,
            activityTime,
            sourceActivity,
            change: rawActivity.change,
        };
        openRunsByFieldType.set(
            fieldType,
            currentRun === undefined
                ? createTaskActivityFeedMergedItemFromEntry(entry)
                : mergeTaskActivityEntryIntoMergedItem(currentRun, entry),
        );
    }

    for (const run of openRunsByFieldType.values()) {
        emitRun(run);
    }

    feedItems.sort((item1, item2) => item1.feedItemTime.getTime() - item2.feedItemTime.getTime());

    if (creationActivity === null) return feedItems;

    const recordedCreationTime = new Date(creationActivity.actionTime[0]);
    const earliestActivityTime = feedItems[0]?.feedItemTime;
    const shouldMoveCreationBeforeActivity =
        earliestActivityTime !== undefined && recordedCreationTime >= earliestActivityTime;

    // HACK: Creation should always read as the start of the feed. Test and migrated
    // data can claim that creation happened after another activity, so move the
    // synthetic item one minute earlier. This makes the feed look correct even though
    // the timestamp can be a lie.
    const creationTime = shouldMoveCreationBeforeActivity
        ? new Date(earliestActivityTime.getTime() - 60 * 1000)
        : recordedCreationTime;
    const creationActionTime: HybridLogicalTime = shouldMoveCreationBeforeActivity
        ? [creationTime.getTime(), 0]
        : creationActivity.actionTime;

    feedItems.unshift({
        type: "TaskCreated",
        feedItemId: `Task:${creationActivity.taskId}:Created`,
        feedItemTime: creationTime,
        actor: creationActivity.actor,
        actionTime: creationActionTime,
        sourceActivities: creationSourceActivities,
    });

    return feedItems;
}

/**
 * The feed identity of one change within an entry.
 */
function getTaskActivityFeedItemId(
    activityEntryId: TaskActivityEntryId,
    changeIndex: number,
): TaskActivityFeedItemId {
    return `${activityEntryId}:${changeIndex}`;
}

function getTaskActivityActorKey(actor: TaskActivityActor | null): string {
    if (actor === null) return "System";
    return actor.from === null
        ? `Account:${actor.account.id}`
        : `Bot:${actor.account.id}:${actor.from.id}`;
}

/**
 * Whether one raw source is creator setup represented by the synthetic creation
 * item. Classifying sources before normal aggregation makes the five-minute cutoff
 * exact for discrete changes and prevents a run from straddling the cutoff.
 *
 * Title windows are indivisible summaries at this layer. A creator-only window
 * that starts during setup folds in full even when its final edit lands after the
 * cutoff.
 */
function isTaskActivitySourceFoldedIntoCreation(
    sourceActivity: TaskActivityFeedSourceActivity,
    creation: TaskActivityFeedCreation,
): boolean {
    if (!isActionFromCreator(sourceActivity, creation.actor)) return false;

    const creationTimeMs = creation.actionTime[0];

    if (sourceActivity.type === "ContentWindow") {
        const window = sourceActivity.window;
        if (window.contentField === "Notes") return false;

        const elapsedMs = window.firstActivityTime.getTime() - creationTimeMs;
        return elapsedMs >= 0 && elapsedMs <= taskActivityCreationFoldWindowMs;
    }

    const {change} = sourceActivity;
    if (change.type === "TaskCreated") return true;

    const elapsedMs = change.actionTime[0] - creationTimeMs;
    if (elapsedMs < 0 || elapsedMs > taskActivityCreationFoldWindowMs) {
        return false;
    }

    switch (change.type) {
        case "TaskAssigneeUpdated": {
            if (creation.actor === null) return false;
            const creatorAccountId = creation.actor.account.id;

            const isFirstAssignmentToCreator =
                change.previousAssignee === null && change.assignee?.id === creatorAccountId;

            const isClearOfCreatorAssignment =
                change.previousAssignee?.id === creatorAccountId && change.assignee === null;

            return isFirstAssignmentToCreator || isClearOfCreatorAssignment;
        }
        case "TaskDeletionUpdated":
        case "TaskStatusUpdated":
            return false;
        case "TaskCollectionMembershipUpdated":
        case "TaskDueDateUpdated":
        case "TaskPriorityUpdated":
        case "TaskParentUpdated":
        case "TaskLayoutUpdated":
            return true;
        default:
            throw exhaustive(change);
    }
}

function mergeTaskCollectionMembershipChangeIntoRun(
    run: Extract<TaskActivityFeedMergedItem, {type: "TaskCollectionMembershipUpdated"}>,
    change: TaskActivityChange & {type: "TaskCollectionMembershipUpdated"},
): TaskActivityFeedMergedItem {
    const existingMembership = run.membershipByCollectionId.get(change.collectionId);

    const membershipByCollectionId = new Map(run.membershipByCollectionId);
    membershipByCollectionId.set(
        change.collectionId,
        existingMembership === undefined
            ? {
                  previousIsMember: change.previousIsMember ?? null,
                  currentIsMember: change.isMember,
              }
            : {
                  previousIsMember: existingMembership.previousIsMember,
                  currentIsMember: change.isMember,
              },
    );

    return {...run, membershipByCollectionId};
}

function createFeedItemFromRun(
    run: TaskActivityFeedMergedItem,
): TaskActivityFeedDiscreteItem | TaskActivityFeedCollectionMembershipItem | null {
    const base = {
        feedItemId: run.feedItemId,
        feedItemTime: run.feedItemTime,
        actor: run.actor,
        sourceActivities: run.sourceActivities,
    } as const;

    if (run.type === "TaskCollectionMembershipUpdated") {
        const addedCollectionIds: Array<TaskCollectionId> = [];
        const removedCollectionIds: Array<TaskCollectionId> = [];

        for (const [collectionId, membership] of run.membershipByCollectionId) {
            // Unknown initial membership counts as changed: hiding a change we can't verify
            // would drop real activity.
            const isChanged =
                membership.previousIsMember === null ||
                membership.previousIsMember !== membership.currentIsMember;
            if (!isChanged) continue;

            if (membership.currentIsMember) addedCollectionIds.push(collectionId);
            else removedCollectionIds.push(collectionId);
        }

        if (addedCollectionIds.length === 0 && removedCollectionIds.length === 0) return null;

        return {
            ...base,
            type: "TaskCollectionMembershipUpdated",
            addedCollectionIds,
            removedCollectionIds,
        };
    }

    // Task creation cannot be undone (though it can be "deleted" in a separate action)
    if (run.type !== "TaskCreated" && isTaskActivityChangeRunReverted(run)) return null;

    return run;
}

/**
 * Merges two changes of the same run: the initial values come from the run's
 * earlier change and the current values from the later one. An absent initial on
 * the earlier change stays absent — the run's before value is unknown.
 *
 * IMPORTANT: This function assumes that the entry should be merged into the run
 * (e.g. the entries are already sorted by action time and that this entry fits in
 * the merged run window).
 */
function mergeTaskActivityEntryIntoMergedItem(
    run: TaskActivityFeedMergedItem,
    entry: {
        activityEntryId: TaskActivityEntryId;
        changeIndex: number;
        activityTime: Date;
        actor: TaskActivityActor | null;
        sourceActivity: TaskActivityFeedSourceActivity;
        change: Exclude<TaskActivityChange, {type: "TaskCreated"}>;
    },
): TaskActivityFeedMergedItem {
    // The first source keeps ownership of the stable item identity. This entry moves
    // the run's current value, time, and retained provenance forward.
    const base = {
        feedItemTime: entry.activityTime,
        actionTime: entry.change.actionTime,
        sourceActivities: [...run.sourceActivities, entry.sourceActivity],
    };

    const change = entry.change;
    switch (change.type) {
        case "TaskDeletionUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                isDeleted: change.isDeleted,
            };
        }
        case "TaskStatusUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                statusType: change.statusType,
            };
        }
        case "TaskAssigneeUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                assignee: change.assignee,
            };
        }
        case "TaskDueDateUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                dueDate: change.dueDate,
            };
        }
        case "TaskPriorityUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                priority: change.priority,
            };
        }
        case "TaskParentUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                parentTaskId: change.parentTaskId,
            };
        }
        case "TaskCollectionMembershipUpdated": {
            assert(run.type === change.type);
            const nextRun = mergeTaskCollectionMembershipChangeIntoRun(
                {
                    ...run,
                    ...base,
                },
                change,
            );
            return nextRun;
        }
        case "TaskLayoutUpdated": {
            assert(run.type === change.type);
            return {
                ...run,
                ...base,
                layout: change.layout,
            };
        }
        default:
            throw exhaustive(change);
    }
}

/** Whether a run's known before value equals its final value. */
function isTaskActivityChangeRunReverted(
    change: Exclude<
        TaskActivityFeedMergedItem,
        {type: "TaskCreated" | "TaskCollectionMembershipUpdated"}
    >,
): boolean {
    switch (change.type) {
        case "TaskDeletionUpdated":
            return (
                change.previousIsDeleted !== undefined &&
                change.previousIsDeleted === change.isDeleted
            );
        case "TaskStatusUpdated":
            return (
                change.previousStatusType !== undefined &&
                change.previousStatusType === change.statusType
            );
        case "TaskAssigneeUpdated":
            return (
                change.previousAssignee !== undefined &&
                (change.previousAssignee?.id ?? null) === (change.assignee?.id ?? null)
            );
        case "TaskDueDateUpdated": {
            const {previousDueDate, dueDate} = change;
            if (previousDueDate === undefined) return false;
            if (previousDueDate === null || dueDate === null) return previousDueDate === dueDate;
            return previousDueDate.compare(dueDate) === 0;
        }
        case "TaskPriorityUpdated":
            return (
                change.previousPriority !== undefined && change.previousPriority === change.priority
            );
        case "TaskParentUpdated":
            return (
                change.previousParentTaskId !== undefined &&
                change.previousParentTaskId === change.parentTaskId
            );
        case "TaskLayoutUpdated":
            return change.previousLayout !== undefined && change.previousLayout === change.layout;
        default:
            throw exhaustive(change);
    }
}

function isActionFromCreator(
    sourceActivity: TaskActivityFeedSourceActivity,
    creationActor: TaskActivityActor | null,
): boolean {
    if (sourceActivity.type === "ContentWindow") {
        return (
            sourceActivity.window.actors.length === 1 &&
            getTaskActivityActorKey(sourceActivity.window.actors[0]!) ===
                getTaskActivityActorKey(creationActor)
        );
    }

    return getTaskActivityActorKey(sourceActivity.actor) === getTaskActivityActorKey(creationActor);
}

function createTaskActivityFeedMergedItemFromEntry(entry: {
    activityEntryId: TaskActivityEntryId;
    changeIndex: number;
    activityTime: Date;
    actor: TaskActivityActor | null;
    sourceActivity: TaskActivityFeedSourceActivity;
    change: Exclude<TaskActivityChange, {type: "TaskCreated"}>;
}): TaskActivityFeedMergedItem {
    const base = {
        feedItemId: getTaskActivityFeedItemId(entry.activityEntryId, entry.changeIndex),
        feedItemTime: entry.activityTime,
        actor: entry.actor,
        actionTime: entry.change.actionTime,
        sourceActivities: [entry.sourceActivity],
    };

    const change = entry.change;
    switch (change.type) {
        case "TaskAssigneeUpdated": {
            return {
                ...base,
                type: "TaskAssigneeUpdated",
                previousAssignee: change.previousAssignee,
                assignee: change.assignee,
            };
        }
        case "TaskDeletionUpdated": {
            return {
                ...base,
                type: "TaskDeletionUpdated",
                previousIsDeleted: change.previousIsDeleted,
                isDeleted: change.isDeleted ?? false,
            };
        }
        case "TaskStatusUpdated": {
            return {
                ...base,
                type: "TaskStatusUpdated",
                previousStatusType: change.previousStatusType,
                statusType: change.statusType ?? "OpenActive",
            };
        }
        case "TaskDueDateUpdated": {
            return {
                ...base,
                type: "TaskDueDateUpdated",
                previousDueDate: change.previousDueDate,
                dueDate: change.dueDate ?? null,
            };
        }
        case "TaskPriorityUpdated": {
            return {
                ...base,
                type: "TaskPriorityUpdated",
                previousPriority: change.previousPriority,
                priority: change.priority ?? null,
            };
        }
        case "TaskParentUpdated": {
            return {
                ...base,
                type: "TaskParentUpdated",
                previousParentTaskId: change.previousParentTaskId,
                parentTaskId: change.parentTaskId,
            };
        }
        case "TaskLayoutUpdated": {
            return {
                ...base,
                type: "TaskLayoutUpdated",
                previousLayout: change.previousLayout,
                layout: change.layout ?? null,
            };
        }
        case "TaskCollectionMembershipUpdated": {
            return mergeTaskCollectionMembershipChangeIntoRun(
                {
                    ...base,
                    type: "TaskCollectionMembershipUpdated",
                    membershipByCollectionId: new Map(),
                },
                change,
            );
        }
        default:
            throw exhaustive(change);
    }
}
