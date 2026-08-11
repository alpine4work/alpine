import {
    SpaceId,
    TaskActivityEntryId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {CalendarDateSchema} from "~/shared/tasks/calendar_date_schema.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskLayoutSchema} from "~/shared/tasks/task_layout.js";
import {TaskPrioritySchema} from "~/shared/tasks/task_priority.js";

/**
 * The before and after values recorded by one discrete task activity entry, as one
 * flat variant per task field. Each variant carries the field's value after the
 * update plus optional `previous*` properties holding the value immediately before
 * it: an absent previous value means the before value wasn't captured (e.g. the
 * crash-recovery fallback), while a null previous value means the field was empty.
 * Read-time aggregation uses the previous value of a run's first entry and the
 * current value of its last entry to detect fully reversed runs (see
 * `deriveTaskActivityFeed()`).
 *
 * Task comments are intentionally absent. Comments remain canonical in the task
 * messaging system and are merged with activity entries when rendering a combined
 * task timeline. Access policy changes are also intentionally absent: they produce
 * no activity, which keeps the feed from leaking the existence of permission
 * changes to viewers who can't see the policy.
 */
export const TaskActivityChangeBaseSchema = Schema.object({
    /**
     * The source action's CRDT version. This orders activity by the same clock that
     * decides which value wins in the task model.
     */
    actionTime: HybridLogicalTimeSchema,
});

export const TaskActivityChangeSchemasWithoutAccountReferences = {
    TaskCreated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskCreated"),
        }),
    ),
    TaskDeletionUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskDeletionUpdated"),
            /** Whether the task was deleted before this activity. */
            previousIsDeleted: Schema.boolean.optional(),
            /** Whether the task is deleted after this activity. */
            isDeleted: Schema.boolean,
        }),
    ),
    // Records the task's DISPLAY status (see `TaskDisplayStatus`) so the feed can say
    // "marked the task as active", not just open/closed. Only actions whose explicit
    // intent is status (`UpdateStatus`, `UpdateAssigneeStatus`) emit this change — an
    // assignee change that implicitly flips active/inactive is already told by its own
    // "assigned the task" entry and doesn't double-report.
    TaskStatusUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskStatusUpdated"),
            /** The task's display status before this activity. */
            previousStatusType: Schema.enum<TaskDisplayStatus>([
                "OpenInactive",
                "OpenActive",
                "Closed",
            ]).optional(),
            /** The task's display status after this activity. */
            statusType: Schema.enum<TaskDisplayStatus>(["OpenInactive", "OpenActive", "Closed"]),
        }),
    ),
    TaskDueDateUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskDueDateUpdated"),
            /** The due date before this activity, or null when no due date was set. */
            previousDueDate: CalendarDateSchema.nullable().optional(),
            /** The due date after this activity, or null when the due date was removed. */
            dueDate: CalendarDateSchema.nullable(),
        }),
    ),
    TaskPriorityUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskPriorityUpdated"),
            /** The priority before this activity, or null when no priority was set. */
            previousPriority: TaskPrioritySchema.nullable().optional(),
            /** The priority after this activity, or null when no priority is set. */
            priority: TaskPrioritySchema.nullable(),
        }),
    ),
    TaskParentUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskParentUpdated"),
            /** The parent before this activity, or null when the task was at the root. */
            previousParentTaskId: Schema.id<TaskId>().nullable().optional(),
            /** The parent after this activity, or null when the task is at the root. */
            parentTaskId: Schema.id<TaskId>().nullable(),
        }),
    ),
    // One discrete entry per collection. Read-time aggregation groups an actor's
    // consecutive membership changes across collections into a single feed item (see
    // `deriveTaskActivityFeed()`), so bulk add/remove operations don't read as N
    // separate activities.
    TaskCollectionMembershipUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskCollectionMembershipUpdated"),
            /** The collection whose membership changed. */
            collectionId: Schema.id<TaskCollectionId>(),
            /** Whether the task belonged to `collectionId` before this activity. */
            previousIsMember: Schema.boolean.optional(),
            /** Whether the task belongs to `collectionId` after this activity. */
            isMember: Schema.boolean,
        }),
    ),
    TaskLayoutUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskLayoutUpdated"),
            /** The task layout before this activity, or null when no layout was set. */
            previousLayout: TaskLayoutSchema.nullable().optional(),
            /** The task layout after this activity, or null when no layout is set. */
            layout: TaskLayoutSchema.nullable(),
        }),
    ),
};

/** One account responsible for activity, plus optional bot provenance. */
export const TaskActivityActorSchema = Schema.object({
    account: AccountModel.schema,
    from: AccountModel.schema.nullable(),
});

export type TaskActivityActor = SchemaType<typeof TaskActivityActorSchema>;

/** A client-visible activity change with account references hydrated inline. */
export const TaskActivityChangeSchema = Schema.union({
    ...TaskActivityChangeSchemasWithoutAccountReferences,
    TaskAssigneeUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskAssigneeUpdated"),
            /** The assigned account before this activity, or null when unassigned. */
            previousAssignee: AccountModel.schema.nullable().optional(),
            /** The assigned account after this activity, or null when unassigned. */
            assignee: AccountModel.schema.nullable(),
        }),
    ),
});

export type TaskActivityChange = SchemaType<typeof TaskActivityChangeSchema>;

/**
 * The client-visible changes from one action transaction.
 *
 * A transaction normally has one actor, so it lives at the top level. Each change
 * carries its source action's hybrid logical time because that is the CRDT version
 * that decides task state and therefore the authoritative activity order. Title
 * and notes updates never appear here — they batch into write-time windows.
 */
// NOTE(ifitzsimmons, 2026-07-28): There's no need for initialData here since this
// model represents immutable DynamoDb records.
export class TaskActivityFeedDiscreteEntryModel extends Model(
    Schema.object({
        /** Stable identity for the entry that stores these changes. */
        activityEntryId: Schema.id<TaskActivityEntryId>(),
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        /**
         * The responsible account and bot provenance, or NULL FOR A SYSTEM UPDATE — an
         * update with no responsible account (automation, background maintenance). Null
         * actors are meaningful data, not absence: the feed renders them as "Alpine", and
         * a window's actor list keeps them so a system edit is never silently credited to
         * the humans in the same window (see `appendTaskActorIfNew()` and the codec's
         * `nullActorIndex`).
         *
         * The client model hydrates both the responsible account and optional bot
         * provenance inline.
         */
        actor: TaskActivityActorSchema.nullable(),
        /**
         * The field values and logical times of the updates this entry's transaction
         * attributed to the task. Never empty — a transaction whose actions produce no
         * activity writes only its idempotency marker.
         */
        changes: Schema.array(TaskActivityChangeSchema),
    }),
) {}

/**
 * One chunk of binary-encoded title or notes activity windows (see
 * `encodeTaskActivityWindowChunk()` for the format). Windows pack many-per-item so
 * a task's whole window history is a couple of small reads, and the open window is
 * always the last window of the latest chunk for its content field — no pointer
 * item to maintain.
 */
// NOTE(ifitzsimmons, 2026-07-28): We don't bother sending `initialData` here even
// though the model can be updated in the database. We don't need a registry for
// activity feed data on the client because we don't need to maintain a consistent
// view of the window across the app – it's only rendered in the task's activity
// feed, and we recompute the activity feed when the chunk is updated.
export class TaskActivityFeedWindowChunkModel extends Model(
    Schema.object({
        /** Densely packed from 1; see the chunk sort ranges on `TaskActivityTable`. */
        chunkNumber: Schema.integer.min(1),
        spaceId: Schema.id<SpaceId>(),
        taskId: Schema.id<TaskId>(),
        /** Which collaborative content field this chunk's windows cover. */
        contentField: Schema.enum(["Title", "Notes"]),
        /** Base time for the window records' second-precision time deltas. */
        baseTime: Schema.date,
        /** The hydrated actor dictionary window records reference by index. */
        actors: Schema.array(TaskActivityActorSchema),
        /** One binary-encoded record per window (see `decodeTaskActivityWindows()`). */
        windows: Schema.array(Schema.bytes),
    }),
) {}

/**
 * The task activity models clients receive from queries and realtime events.
 */
export const TaskActivityModelSchema = createModelUnionSchema({
    TaskActivityEntry: TaskActivityFeedDiscreteEntryModel,
    TaskActivityWindowChunk: TaskActivityFeedWindowChunkModel,
});

export type TaskActivityModel = SchemaType<typeof TaskActivityModelSchema>;
